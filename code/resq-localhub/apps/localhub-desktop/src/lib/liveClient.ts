import type {
  LiveConnectionState,
  LiveFallbackSnapshot,
  LiveMetricPayload,
  LiveSourceMode,
} from "@resq/shared";
import { getHubApiBaseUrl, getLocalServiceHost } from "./hubApiUrl";
import { createMqttLiveClient, type MqttLiveClient } from "./mqttLiveClient";
import { createPollingLiveClient, type PollingLiveClient } from "./pollingLiveClient";
import { createSseLiveClient, type SseLiveClient } from "./sseLiveClient";
import { isLiveUpdateForSelection, type LiveClientUpdate } from "./liveClientTypes";

export type LiveClientOptions = {
  deviceId: string;
  sessionId?: string | null;
  enabled: boolean;
  mqttUrl?: string;
  mqttUsername?: string | null;
  mqttPassword?: string | null;
  backendBaseUrl?: string;
  mqttMaxRetries?: number;
  mqttStableMs?: number;
  staleAfterMs?: number;
  offlineAfterMs?: number;
  pollingIntervalMs?: number;
  recoveryProbeIntervalMs?: number;
};

export type LiveClientState = LiveFallbackSnapshot & {
  sourceMode: LiveSourceMode;
  connectionState: LiveConnectionState;
  latestMetric: LiveMetricPayload | null;
  lastHeartbeatAt: string | number | null;
  lastStatusAt: string | number | null;
  lastEventType: string | null;
  error: string | null;
};

export type LiveClientSubscription = {
  getState(): LiveClientState;
  stop(): void;
};

type SourceKind = "mqtt" | "sse" | "polling";

const DEFAULT_MQTT_MAX_RETRIES = 3;
const DEFAULT_MQTT_STABLE_MS = 4000;
const DEFAULT_STALE_AFTER_MS = 2000;
const DEFAULT_OFFLINE_AFTER_MS = 8000;
const DEFAULT_POLLING_INTERVAL_MS = 1500;
const DEFAULT_RECOVERY_PROBE_INTERVAL_MS = 5000;

export function createLiveClient(
  options: LiveClientOptions,
  onState: (state: LiveClientState) => void,
): LiveClientSubscription {
  const manager = new LiveClientManager(options, onState);
  manager.start();
  return manager;
}

export function getDefaultBackendBaseUrl(): string {
  return getHubApiBaseUrl();
}

export function getDefaultMqttWebSocketUrl(): string {
  const configuredUrl = import.meta.env.VITE_RESQ_MQTT_WS_URL;
  if (typeof configuredUrl === "string" && configuredUrl.trim()) {
    return configuredUrl.trim();
  }

  if (typeof window === "undefined") {
    return "ws://localhost:9001";
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${getLocalServiceHost()}:9001`;
}

function initialState(options: LiveClientOptions): LiveClientState {
  return {
    deviceId: options.deviceId,
    sessionId: options.sessionId ?? null,
    latestMetric: null,
    lastSeenAt: null,
    connectionState: options.enabled ? "CONNECTING" : "OFFLINE",
    sourceMode: "NONE",
    stale: false,
    offline: !options.enabled,
    message: null,
    lastHeartbeatAt: null,
    lastStatusAt: null,
    lastEventType: null,
    firmwareState: null,
    calibrated: null,
    sessionActive: null,
    lastErrorId: null,
    eventId: null,
    reasonId: null,
    actionId: null,
    progressId: null,
    error: null,
  };
}

class LiveClientManager implements LiveClientSubscription {
  private readonly options: Required<
    Pick<
      LiveClientOptions,
      | "mqttMaxRetries"
      | "mqttStableMs"
      | "staleAfterMs"
      | "offlineAfterMs"
      | "pollingIntervalMs"
      | "recoveryProbeIntervalMs"
    >
  > &
    LiveClientOptions;

  private readonly onState: (state: LiveClientState) => void;
  private state: LiveClientState;
  private mqttClient: MqttLiveClient | null = null;
  private sseClient: SseLiveClient | null = null;
  private pollingClient: PollingLiveClient | null = null;
  private activeSource: SourceKind | null = null;
  private mqttRetryCount = 0;
  private stopped = false;
  private staleTimer: number | null = null;
  private recoveryTimer: number | null = null;
  private mqttStableTimer: number | null = null;
  private lastTelemetryReceivedAt = 0;
  private lastDeviceSignalReceivedAt = 0;
  private hasHeartbeatOrStatus = false;

  constructor(options: LiveClientOptions, onState: (state: LiveClientState) => void) {
    this.options = {
      ...options,
      mqttMaxRetries: options.mqttMaxRetries ?? DEFAULT_MQTT_MAX_RETRIES,
      mqttStableMs: options.mqttStableMs ?? DEFAULT_MQTT_STABLE_MS,
      staleAfterMs: options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS,
      offlineAfterMs: options.offlineAfterMs ?? DEFAULT_OFFLINE_AFTER_MS,
      pollingIntervalMs: options.pollingIntervalMs ?? DEFAULT_POLLING_INTERVAL_MS,
      recoveryProbeIntervalMs: options.recoveryProbeIntervalMs ?? DEFAULT_RECOVERY_PROBE_INTERVAL_MS,
    };
    this.onState = onState;
    this.state = initialState(options);
  }

  start(): void {
    if (!this.options.enabled || !this.options.deviceId) {
      this.emit();
      return;
    }

    this.emit();
    this.staleTimer = window.setInterval(() => this.refreshHealthFlags(), 500);
    if (this.options.sessionId) {
      this.startSse();
    } else {
      this.startMqtt(false);
    }
  }

  getState(): LiveClientState {
    return this.state;
  }

  stop(): void {
    this.stopped = true;
    this.stopAllSources();
    this.clearTimer("staleTimer");
    this.clearTimer("recoveryTimer");
    this.clearTimer("mqttStableTimer");
  }

  private startMqtt(isRecoveryProbe: boolean): void {
    if (this.stopped) {
      return;
    }

    this.stopMqtt();
    this.mqttClient = createMqttLiveClient(
      {
        deviceId: this.options.deviceId,
        sessionId: this.options.sessionId,
        url: this.options.mqttUrl ?? getDefaultMqttWebSocketUrl(),
        username: this.options.mqttUsername,
        password: this.options.mqttPassword,
      },
      {
        onOpen: () => {
          this.debug("mqtt websocket connected");
          this.mqttRetryCount = 0;
          if (isRecoveryProbe) {
            this.mqttStableTimer = window.setTimeout(() => this.promoteMqttAfterRecovery(), this.options.mqttStableMs);
            return;
          }

          this.activeSource = "mqtt";
          this.stopSse();
          this.stopPolling();
          this.patchState({
            connectionState: "MQTT_WS_LIVE",
            sourceMode: "DIRECT_MQTT",
            error: null,
            message: null,
          });
        },
        onUpdate: (update) => {
          if (!isLiveUpdateForSelection(update, this.options.deviceId, this.options.sessionId)) {
            return;
          }
          this.applyUpdate(update, isRecoveryProbe ? null : "mqtt");
        },
        onError: (error) => this.handleMqttFailure(error, isRecoveryProbe),
        onClose: () => this.handleMqttFailure(new Error("MQTT WebSocket closed"), isRecoveryProbe),
      },
    );
    this.mqttClient.start();
  }

  private handleMqttFailure(error: Error, isRecoveryProbe: boolean): void {
    if (this.stopped) {
      return;
    }

    this.clearTimer("mqttStableTimer");
    if (isRecoveryProbe) {
      this.debug("mqtt recovery probe failed", error);
      this.stopMqtt();
      return;
    }

    this.mqttRetryCount += 1;
    if (this.mqttRetryCount <= this.options.mqttMaxRetries) {
      this.debug(`mqtt retry ${this.mqttRetryCount}/${this.options.mqttMaxRetries}`, error);
      window.setTimeout(() => this.startMqtt(false), 750);
      return;
    }

    this.debug("mqtt exhausted retries; falling back to sse", error);
    this.stopMqtt();
    this.startSse(error.message);
  }

  private promoteMqttAfterRecovery(): void {
    if (this.stopped || !this.mqttClient) {
      return;
    }

    this.debug("mqtt websocket recovered and stayed stable");
    this.activeSource = "mqtt";
    this.stopSse();
    this.stopPolling();
    this.patchState({
      connectionState: "MQTT_WS_LIVE",
      sourceMode: "DIRECT_MQTT",
      error: null,
      message: null,
    });
  }

  private startSse(message?: string): void {
    this.activeSource = "sse";
    this.stopSse();
    this.sseClient = createSseLiveClient(
      {
        deviceId: this.options.deviceId,
        sessionId: this.options.sessionId,
        backendBaseUrl: this.options.backendBaseUrl ?? getDefaultBackendBaseUrl(),
      },
      {
        onOpen: () => {
          this.patchState({
            connectionState: "BACKEND_SSE_FALLBACK",
            sourceMode: "BACKEND_SSE",
            error: null,
            message: message ?? null,
          });
          this.startRecoveryProbeLoop();
        },
        onUpdate: (update) => this.applyUpdate(update, "sse"),
        onError: (error) => {
          this.debug("sse failed; falling back to polling", error);
          this.stopSse();
          this.startPolling(error.message);
        },
      },
    );
    this.sseClient.start();
  }

  private startPolling(message?: string): void {
    this.activeSource = "polling";
    this.stopPolling();
    this.pollingClient = createPollingLiveClient(
      {
        deviceId: this.options.deviceId,
        sessionId: this.options.sessionId,
        backendBaseUrl: this.options.backendBaseUrl ?? getDefaultBackendBaseUrl(),
        intervalMs: this.options.pollingIntervalMs,
      },
      {
        onUpdate: (update) => this.applyUpdate(update, "polling"),
        onError: (error) => {
          this.patchState({
            connectionState: this.state.latestMetric ? this.state.connectionState : "ERROR",
            sourceMode: "BACKEND_POLLING",
            error: error.message,
            message,
          });
        },
      },
    );
    this.pollingClient.start();
    this.patchState({
      connectionState: "BACKEND_POLLING_DEGRADED",
      sourceMode: "BACKEND_POLLING",
      error: null,
      message: message ?? null,
    });
    this.startRecoveryProbeLoop();
  }

  private startRecoveryProbeLoop(): void {
    if (this.options.sessionId || this.recoveryTimer !== null || this.activeSource === "mqtt") {
      return;
    }

    this.recoveryTimer = window.setInterval(() => {
      if (!this.stopped && this.activeSource !== "mqtt" && !this.mqttClient) {
        this.startMqtt(true);
      }
    }, this.options.recoveryProbeIntervalMs);
  }

  private applyUpdate(update: LiveClientUpdate, source: SourceKind | null): void {
    if (!isLiveUpdateForSelection(update, this.options.deviceId, this.options.sessionId)) {
      return;
    }

    const now = Date.now();
    if (update.latestMetric) {
      this.lastTelemetryReceivedAt = now;
    }
    if (update.latestMetric || update.heartbeatSeen || update.statusSeen) {
      this.lastDeviceSignalReceivedAt = now;
    }
    if (update.heartbeatSeen || update.statusSeen) {
      this.hasHeartbeatOrStatus = true;
    }

    const sourceMode = sourceToMode(source, this.state.sourceMode);
    this.patchState({
      deviceId: update.deviceId,
      sessionId: update.sessionId ?? this.state.sessionId,
      latestMetric: update.latestMetric ?? this.state.latestMetric,
      lastSeenAt: update.lastSeenAt ?? new Date(now).toISOString(),
      lastHeartbeatAt: update.heartbeatSeen ? new Date(now).toISOString() : this.state.lastHeartbeatAt,
      lastStatusAt: update.statusSeen ? new Date(now).toISOString() : this.state.lastStatusAt,
      lastEventType: update.eventType ?? this.state.lastEventType,
      firmwareState: update.firmwareState ?? update.latestMetric?.firmwareState ?? this.state.firmwareState,
      calibrated: update.calibrated ?? update.latestMetric?.calibrated ?? this.state.calibrated,
      sessionActive: update.sessionActive ?? update.latestMetric?.sessionActive ?? this.state.sessionActive,
      lastErrorId: update.lastErrorId ?? update.latestMetric?.lastErrorId ?? this.state.lastErrorId,
      eventId: update.eventId ?? update.latestMetric?.eventId ?? this.state.eventId,
      reasonId: update.reasonId ?? update.latestMetric?.reasonId ?? this.state.reasonId,
      actionId: update.actionId ?? update.latestMetric?.actionId ?? this.state.actionId,
      progressId: update.progressId ?? update.latestMetric?.progressId ?? this.state.progressId,
      connectionState: this.connectionStateForSource(source, update),
      sourceMode,
      stale: update.stale ?? false,
      offline: update.offline ?? false,
      error: null,
    });
    this.refreshHealthFlags();
  }

  private connectionStateForSource(source: SourceKind | null, update: LiveClientUpdate): LiveConnectionState {
    if (update.offline) {
      return "OFFLINE";
    }
    if (update.stale) {
      return "STALE";
    }
    if (source === "mqtt") {
      return "MQTT_WS_LIVE";
    }
    if (source === "sse") {
      return "BACKEND_SSE_FALLBACK";
    }
    if (source === "polling") {
      return "BACKEND_POLLING_DEGRADED";
    }
    return this.state.connectionState;
  }

  private refreshHealthFlags(): void {
    if (this.stopped || !this.options.enabled) {
      return;
    }

    const now = Date.now();
    const stale = this.lastTelemetryReceivedAt > 0 && now - this.lastTelemetryReceivedAt > this.options.staleAfterMs;
    const offline =
      this.hasHeartbeatOrStatus &&
      this.lastDeviceSignalReceivedAt > 0 &&
      now - this.lastDeviceSignalReceivedAt > this.options.offlineAfterMs;

    if (offline && this.state.connectionState !== "OFFLINE") {
      this.patchState({ connectionState: "OFFLINE", offline: true, stale });
      return;
    }

    if (stale && this.state.connectionState !== "STALE" && !offline) {
      this.patchState({ connectionState: "STALE", stale: true, offline: false });
      return;
    }

    if (!stale && !offline && (this.state.stale || this.state.offline)) {
      this.patchState({
        connectionState: modeToConnectionState(this.state.sourceMode),
        stale: false,
        offline: false,
      });
    }
  }

  private patchState(patch: Partial<LiveClientState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit(): void {
    this.onState(this.state);
  }

  private stopAllSources(): void {
    this.stopMqtt();
    this.stopSse();
    this.stopPolling();
  }

  private stopMqtt(): void {
    this.clearTimer("mqttStableTimer");
    this.mqttClient?.stop();
    this.mqttClient = null;
  }

  private stopSse(): void {
    this.sseClient?.stop();
    this.sseClient = null;
  }

  private stopPolling(): void {
    this.pollingClient?.stop();
    this.pollingClient = null;
  }

  private clearTimer(name: "staleTimer" | "recoveryTimer" | "mqttStableTimer"): void {
    const timer = this[name];
    if (timer !== null) {
      window.clearInterval(timer);
      window.clearTimeout(timer);
      this[name] = null;
    }
  }

  private debug(message: string, detail?: unknown): void {
    if (import.meta.env.DEV) {
      console.debug(`[ResQ live] ${message}`, detail ?? "");
    }
  }
}

function sourceToMode(source: SourceKind | null, fallback: LiveSourceMode): LiveSourceMode {
  if (source === "mqtt") {
    return "DIRECT_MQTT";
  }
  if (source === "sse") {
    return "BACKEND_SSE";
  }
  if (source === "polling") {
    return "BACKEND_POLLING";
  }
  return fallback;
}

function modeToConnectionState(mode: LiveSourceMode): LiveConnectionState {
  if (mode === "DIRECT_MQTT") {
    return "MQTT_WS_LIVE";
  }
  if (mode === "BACKEND_SSE") {
    return "BACKEND_SSE_FALLBACK";
  }
  if (mode === "BACKEND_POLLING") {
    return "BACKEND_POLLING_DEGRADED";
  }
  return "CONNECTING";
}
