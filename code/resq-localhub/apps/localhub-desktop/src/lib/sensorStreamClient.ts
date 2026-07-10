import { createSseClient, type SseClient } from "./sseLiveClient";
import { getHubApiBaseUrl } from "./hubApiUrl";
import {
  parseSensorStreamSnapshot,
  type LatestSensorStreamResponse,
  type SensorStreamCommandResponse,
  type SensorStreamSnapshot,
} from "./sensorStreamTypes";

export type SensorStreamClientCallbacks = {
  onOpen(): void;
  onSnapshot(snapshot: SensorStreamSnapshot): void;
  onError(error: Error): void;
};

type RawCommandResponse = {
  deviceId?: string;
  device_id?: string;
  requestId?: string;
  request_id?: string;
  action?: string;
  command?: string;
  topic?: string;
  intervalMs?: number;
  interval_ms?: number;
  status?: string;
};

type RawLatestResponse = {
  device_id?: string;
  deviceId?: string;
  stream_observed?: boolean;
  streamObserved?: boolean;
  latest_snapshot?: unknown;
  latestSnapshot?: unknown;
  receivedAt?: string;
};

function telemetryUrl(deviceId: string, suffix: string): string {
  return `${getHubApiBaseUrl()}/api/devices/${encodeURIComponent(deviceId)}/telemetry${suffix}`;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as T | null;
  if (!response.ok) {
    const message = body && typeof body === "object"
      ? ((body as Record<string, unknown>).error ?? (body as Record<string, unknown>).message)
      : null;
    throw new Error(typeof message === "string" ? message : `Sensor stream request failed (${response.status})`);
  }
  return body as T;
}

export async function startSensorStream(deviceId: string, intervalMs: number): Promise<SensorStreamCommandResponse> {
  const raw = await fetch(telemetryUrl(deviceId, "/start"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ interval_ms: intervalMs }),
  }).then((response) => readJson<RawCommandResponse>(response));
  return mapCommandResponse(raw, deviceId, "START");
}

export async function stopSensorStream(deviceId: string): Promise<SensorStreamCommandResponse> {
  const raw = await fetch(telemetryUrl(deviceId, "/stop"), {
    method: "POST",
    credentials: "include",
  }).then((response) => readJson<RawCommandResponse>(response));
  return mapCommandResponse(raw, deviceId, "STOP");
}

export async function getLatestSensorStream(deviceId: string): Promise<LatestSensorStreamResponse | null> {
  const response = await fetch(telemetryUrl(deviceId, "/latest"), {
    method: "GET",
    credentials: "include",
  });

  if (response.status === 404 || response.status === 204) {
    return null;
  }

  const raw = await readJson<RawLatestResponse>(response);
  const snapshot = parseSensorStreamSnapshot(raw.latest_snapshot ?? raw.latestSnapshot, deviceId);
  if (!snapshot) {
    return null;
  }

  return {
    deviceId: raw.device_id ?? raw.deviceId ?? deviceId,
    streamObserved: raw.stream_observed ?? raw.streamObserved ?? true,
    latestSnapshot: snapshot,
    receivedAt: raw.receivedAt ?? snapshot.receivedAt,
  };
}

export function createSensorStreamClient(deviceId: string, callbacks: SensorStreamClientCallbacks): SseClient {
  return createSseClient<SensorStreamSnapshot>(
    `${getHubApiBaseUrl()}/api/stream/devices/${encodeURIComponent(deviceId)}/sensor-stream`,
    {
      onOpen: callbacks.onOpen,
      onMessage: callbacks.onSnapshot,
      onError: callbacks.onError,
    },
    (eventName, raw) => {
      if (eventName !== "sensor-stream") {
        return [];
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return [];
      }
      const snapshot = parseSensorStreamSnapshot(parsed, deviceId);
      return snapshot ? [snapshot] : [];
    },
  );
}

function mapCommandResponse(raw: RawCommandResponse, deviceId: string, fallbackAction: "START" | "STOP"): SensorStreamCommandResponse {
  const action = raw.action === "STOP" || raw.action === "START" ? raw.action : fallbackAction;
  return {
    deviceId: raw.deviceId ?? raw.device_id ?? deviceId,
    requestId: raw.requestId ?? raw.request_id ?? "",
    action,
    command: raw.command ?? `telemetry/${action.toLowerCase()}`,
    topic: raw.topic ?? "",
    intervalMs: raw.intervalMs ?? raw.interval_ms,
    status: raw.status ?? "PUBLISHED",
  };
}
