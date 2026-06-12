import { useEffect, useMemo, useState } from "react";
import {
  createLiveClient,
  getDefaultBackendBaseUrl,
  getDefaultMqttWebSocketUrl,
  type LiveClientOptions,
  type LiveClientState,
} from "../lib/liveClient";

export type UseLiveSessionOptions = {
  deviceId: string | null | undefined;
  sessionId?: string | null;
  enabled?: boolean;
  mqttUrl?: string;
  mqttUsername?: string | null;
  mqttPassword?: string | null;
  backendBaseUrl?: string;
  debugMqtt?: boolean;
};

export function useLiveSession(options: UseLiveSessionOptions): LiveClientState {
  const enabled = options.enabled ?? true;
  const deviceId = options.deviceId?.trim() ?? "";
  const sessionId = options.sessionId?.trim() || null;
  const mqttUrl = options.mqttUrl ?? getDefaultMqttWebSocketUrl();
  const mqttUsername = options.mqttUsername ?? import.meta.env.VITE_RESQ_MQTT_DASHBOARD_USERNAME ?? null;
  const mqttPassword = options.mqttPassword ?? import.meta.env.VITE_RESQ_MQTT_DASHBOARD_PASSWORD ?? null;
  const backendBaseUrl = options.backendBaseUrl ?? getDefaultBackendBaseUrl();

  const clientOptions = useMemo<LiveClientOptions>(
    () => ({
      deviceId,
      sessionId,
      enabled: enabled && deviceId.length > 0,
      mqttUrl,
      mqttUsername,
      mqttPassword,
      backendBaseUrl,
      debugMqtt: options.debugMqtt,
    }),
    [backendBaseUrl, deviceId, enabled, mqttPassword, mqttUrl, mqttUsername, sessionId, options.debugMqtt],
  );

  const [state, setState] = useState<LiveClientState>(() => ({
    deviceId,
    sessionId,
    latestMetric: null,
    lastSeenAt: null,
    connectionState: clientOptions.enabled ? "CONNECTING" : "OFFLINE",
    sourceMode: "NONE",
    stale: false,
    offline: !clientOptions.enabled,
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
  }));

  useEffect(() => {
    setState((previous) => ({
      ...previous,
      deviceId,
      sessionId,
      latestMetric: null,
      lastSeenAt: null,
      connectionState: clientOptions.enabled ? "CONNECTING" : "OFFLINE",
      sourceMode: "NONE",
      stale: false,
      offline: !clientOptions.enabled,
      error: null,
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
    }));

    if (!clientOptions.enabled) {
      return undefined;
    }

    const subscription = createLiveClient(clientOptions, setState);
    return () => {
      subscription.stop();
    };
  }, [clientOptions, deviceId, sessionId]);

  return state;
}
