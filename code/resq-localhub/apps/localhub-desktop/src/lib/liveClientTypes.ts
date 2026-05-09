import type { LiveConnectionState, LiveMetricPayload } from "@resq/shared";

export type LiveClientUpdate = {
  deviceId: string;
  sessionId?: string | null;
  latestMetric?: LiveMetricPayload | null;
  lastSeenAt?: string | number | null;
  heartbeatSeen?: boolean;
  statusSeen?: boolean;
  eventType?: string | null;
  connectionState?: LiveConnectionState | null;
  stale?: boolean | null;
  offline?: boolean | null;
};

export function isLiveUpdateForSelection(
  update: Pick<LiveClientUpdate, "deviceId" | "sessionId">,
  deviceId: string,
  sessionId?: string | null,
): boolean {
  if (update.deviceId !== deviceId) {
    return false;
  }

  if (sessionId && update.sessionId && update.sessionId !== sessionId) {
    return false;
  }

  return true;
}

export function toLiveClientUpdate(raw: unknown): LiveClientUpdate | null {
  if (!isRecord(raw)) {
    return null;
  }

  const latestMetric = isRecord(raw.latestMetric) ? toLiveMetric(raw.latestMetric) : null;
  const deviceId = text(raw.deviceId) ?? latestMetric?.deviceId;
  if (!deviceId) {
    return null;
  }

  return {
    deviceId,
    sessionId: text(raw.sessionId) ?? latestMetric?.sessionId ?? null,
    latestMetric,
    lastSeenAt:
      timestampOrNull(raw.lastSeenAt) ??
      timestampOrNull(raw.lastSeen) ??
      timestampOrNull(raw.timestamp) ??
      latestMetric?.timestamp ??
      latestMetric?.tsMs ??
      null,
    heartbeatSeen: false,
    statusSeen: false,
    eventType: text(raw.lastEventType) ?? text(raw.eventType) ?? text(raw.type),
    connectionState: liveConnectionState(raw.connectionState),
    stale: booleanOrNull(raw.stale),
    offline: booleanOrNull(raw.offline),
  };
}

export function toLiveMetric(raw: unknown): LiveMetricPayload | null {
  if (!isRecord(raw)) {
    return null;
  }

  const deviceId = text(raw.deviceId) ?? text(raw.device_id);
  const sessionId = text(raw.sessionId) ?? text(raw.session_id);
  if (!deviceId || !sessionId) {
    return null;
  }

  return {
    deviceId,
    manikinId: text(raw.manikinId) ?? text(raw.manikin_id),
    sessionId,
    seq: numberOrNull(raw.seq),
    tsMs: numberOrNull(raw.tsMs ?? raw.ts_ms),
    timestamp: timestampOrNull(raw.timestamp),
    depthMm: numberOrNull(raw.depthMm ?? raw.depth_mm ?? raw.current_delta),
    rateCpm: numberOrNull(raw.rateCpm ?? raw.rate_cpm),
    recoilOk: booleanOrNull(raw.recoilOk ?? raw.recoil_ok ?? raw.recoil),
    pauseS: numberOrNull(raw.pauseS ?? raw.pause_s),
    compressionCount: numberOrNull(raw.compressionCount ?? raw.compression_count ?? raw.total_compressions),
    handPlacement: text(raw.handPlacement) ?? text(raw.hand_placement),
    flags: flagsOrNull(raw.flags),
    sourceMode: undefined,
    debugRaw: raw.debugRaw,
  };
}

function liveConnectionState(value: unknown): LiveConnectionState | null {
  if (
    value === "CONNECTING" ||
    value === "MQTT_WS_LIVE" ||
    value === "BACKEND_SSE_FALLBACK" ||
    value === "BACKEND_POLLING_DEGRADED" ||
    value === "STALE" ||
    value === "OFFLINE" ||
    value === "ERROR"
  ) {
    return value;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function timestampOrNull(value: unknown): string | number | null {
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }
  return null;
}

function flagsOrNull(value: unknown): string | string[] | null {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }
  return null;
}
