export type LiveMetricSourceMode = "real" | "simulator" | "calibration" | "debug" | "hall";

export const LIVE_CONNECTION_STATES = [
  "CONNECTING",
  "MQTT_WS_LIVE",
  "BACKEND_SSE_FALLBACK",
  "BACKEND_POLLING_DEGRADED",
  "STALE",
  "OFFLINE",
  "ERROR",
] as const;

export type LiveConnectionState = (typeof LIVE_CONNECTION_STATES)[number];

export const LIVE_SOURCE_MODES = ["DIRECT_MQTT", "BACKEND_SSE", "BACKEND_POLLING", "NONE"] as const;

export type LiveSourceMode = (typeof LIVE_SOURCE_MODES)[number];

export type LiveDeviceStatus = {
  deviceId: string;
  manikinId?: string | null;
  online: boolean;
  lastSeenAt?: string | number | null;
  state?: string | null;
  ip?: string | null;
  firmwareVersion?: string | null;
  rssi?: number | null;
  battery?: number | null;
  sessionActive?: boolean | null;
  firmwareState?: string | null;
  calibrated?: boolean | null;
  lastErrorId?: string | null;
};

export type LiveSessionStatus = {
  sessionId: string;
  deviceId: string;
  manikinId?: string | null;
  traineeId?: string | null;
  active: boolean;
  startedAt?: string | number | null;
  endedAt?: string | number | null;
  profileId?: string | null;
  scenario?: string | null;
  notes?: string | null;
};

export type LiveMetricPayload = {
  deviceId: string;
  manikinId?: string | null;
  sessionId: string;
  seq?: number | null;
  tsMs?: number | null;
  timestamp?: string | number | null;
  depthMm: number | null;
  depthProgress?: number | null;
  depthOk?: boolean | null;
  rateCpm: number | null;
  recoilOk: boolean | null;
  recoilOkCount?: number | null;
  incompleteRecoilCount?: number | null;
  pauseS: number | null;
  compressionCount: number | null;
  validCompressionCount?: number | null;
  handPlacement: string | null;
  pressureBalancePct?: number | null;
  flags: string | string[] | null;
  sessionActive?: boolean | null;
  firmwareState?: string | null;
  calibrated?: boolean | null;
  lastErrorId?: string | null;
  eventId?: number | null;
  reasonId?: string | null;
  actionId?: number | null;
  progressId?: number | null;
  sourceMode?: LiveMetricSourceMode;
  rawPayload?: unknown;
  debugRaw?: unknown;
};

export type LiveFallbackSnapshot = {
  deviceId: string;
  sessionId?: string | null;
  latestMetric?: LiveMetricPayload | null;
  lastSeenAt: string | number | null;
  connectionState: LiveConnectionState;
  sourceMode: LiveSourceMode;
  stale: boolean;
  offline: boolean;
  message?: string | null;
  firmwareState?: string | null;
  calibrated?: boolean | null;
  sessionActive?: boolean | null;
  lastErrorId?: string | null;
  eventId?: number | null;
  reasonId?: string | null;
  actionId?: number | null;
  progressId?: number | null;
};
