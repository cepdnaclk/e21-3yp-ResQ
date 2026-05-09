import mqtt, { type MqttClient } from "mqtt";
import { toLiveMetric, type LiveClientUpdate } from "./liveClientTypes";

export type MqttLiveClientOptions = {
  deviceId: string;
  sessionId?: string | null;
  url: string;
};

export type MqttLiveClientCallbacks = {
  onOpen(): void;
  onUpdate(update: LiveClientUpdate): void;
  onError(error: Error): void;
  onClose(): void;
};

export type MqttLiveClient = {
  start(): void;
  stop(): void;
};

const MQTT_TOPIC_KINDS = ["telemetry", "status", "heartbeat", "events"] as const;

export function createMqttLiveClient(
  options: MqttLiveClientOptions,
  callbacks: MqttLiveClientCallbacks,
): MqttLiveClient {
  let client: MqttClient | null = null;
  let stopped = false;
  let closeNotified = false;

  function start(): void {
    stopped = false;
    closeNotified = false;
    const clientId = `resq-live-${options.deviceId}-${crypto.randomUUID?.() ?? Date.now().toString(36)}`;
    client = mqtt.connect(options.url, {
      clientId,
      clean: true,
      connectTimeout: 3000,
      reconnectPeriod: 0,
      resubscribe: false,
    });

    client.on("connect", () => {
      if (stopped || !client) {
        return;
      }
      const topics = MQTT_TOPIC_KINDS.map((kind) => `resq/manikins/${options.deviceId}/${kind}`);
      client.subscribe(topics, { qos: 0 }, (error) => {
        if (error) {
          callbacks.onError(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        callbacks.onOpen();
      });
    });

    client.on("message", (topic, payload) => {
      const update = parseMqttMessage(topic, payload);
      if (!update) {
        return;
      }
      callbacks.onUpdate(update);
    });

    client.on("error", (error) => {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    });

    client.on("close", () => {
      if (!stopped && !closeNotified) {
        closeNotified = true;
        callbacks.onClose();
      }
    });
  }

  function stop(): void {
    stopped = true;
    closeNotified = true;
    if (client) {
      client.end(true);
      client = null;
    }
  }

  function parseMqttMessage(topic: string, payload: Uint8Array): LiveClientUpdate | null {
    const parsedTopic = parseTopic(topic);
    if (!parsedTopic || parsedTopic.deviceId !== options.deviceId) {
      return null;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      return null;
    }

    if (!isRecord(raw)) {
      return null;
    }

    const payloadDeviceId = text(raw.deviceId) ?? text(raw.device_id) ?? parsedTopic.deviceId;
    const payloadSessionId = text(raw.sessionId) ?? text(raw.session_id) ?? null;
    if (payloadDeviceId !== options.deviceId) {
      return null;
    }
    if (options.sessionId && payloadSessionId && payloadSessionId !== options.sessionId) {
      return null;
    }

    if (parsedTopic.kind === "telemetry") {
      const metric = toLiveMetric({ ...raw, deviceId: payloadDeviceId, sessionId: payloadSessionId ?? options.sessionId });
      if (!metric) {
        return null;
      }
      return {
        deviceId: metric.deviceId,
        sessionId: metric.sessionId,
        latestMetric: metric,
        lastSeenAt: metric.timestamp ?? metric.tsMs ?? Date.now(),
      };
    }

    if (parsedTopic.kind === "heartbeat") {
      return {
        deviceId: payloadDeviceId,
        sessionId: payloadSessionId,
        heartbeatSeen: true,
        lastSeenAt: timestampOrNow(raw.timestamp ?? raw.tsMs),
      };
    }

    if (parsedTopic.kind === "status") {
      return {
        deviceId: payloadDeviceId,
        sessionId: payloadSessionId,
        statusSeen: true,
        lastSeenAt: timestampOrNow(raw.timestamp ?? raw.tsMs),
      };
    }

    return {
      deviceId: payloadDeviceId,
      sessionId: payloadSessionId,
      eventType: text(raw.eventType) ?? text(raw.type),
      lastSeenAt: timestampOrNow(raw.timestamp ?? raw.tsMs),
    };
  }

  return { start, stop };
}

function parseTopic(topic: string): { deviceId: string; kind: (typeof MQTT_TOPIC_KINDS)[number] } | null {
  const parts = topic.split("/");
  if (parts.length !== 4 || parts[0] !== "resq" || parts[1] !== "manikins") {
    return null;
  }

  const kind = parts[3];
  if (!isMqttTopicKind(kind)) {
    return null;
  }

  return { deviceId: parts[2], kind };
}

function isMqttTopicKind(value: string): value is (typeof MQTT_TOPIC_KINDS)[number] {
  return MQTT_TOPIC_KINDS.some((kind) => kind === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function timestampOrNow(value: unknown): string | number {
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }
  return Date.now();
}
