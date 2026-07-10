export const SENSOR_STREAM_MIN_INTERVAL_MS = 100;
export const SENSOR_STREAM_DEFAULT_INTERVAL_MS = 200;
export const SENSOR_STREAM_MAX_INTERVAL_MS = 1000;

export type SensorStreamUiState =
  | "IDLE"
  | "STARTING"
  | "RUNNING"
  | "STOPPING"
  | "STALE"
  | "RECONNECTING"
  | "ERROR";

export type SensorStreamSnapshot = {
  deviceId: string;
  telemetryMode: "SENSOR_STREAM";
  state: string;
  pressure0Kpa: number;
  pressure0KpaValid: boolean;
  pressure1Kpa: number;
  pressure1KpaValid: boolean;
  pressure2Kpa: number;
  pressure2KpaValid: boolean;
  pressureKpaValid: boolean;
  hallMm: number;
  hallProgress: number;
  hallMmValid: boolean;
  pressureSaturationMask: number;
  intervalMs: number;
  firmwareTimestampMs: number;
  receivedAt: string;
};

export type SensorStreamCommandResponse = {
  deviceId: string;
  requestId: string;
  action: "START" | "STOP";
  command: string;
  topic: string;
  intervalMs?: number;
  status: string;
};

export type LatestSensorStreamResponse = {
  deviceId: string;
  streamObserved: boolean;
  latestSnapshot: SensorStreamSnapshot;
  receivedAt: string;
};

export function validateSensorStreamInterval(value: string): string | null {
  if (value.trim() === "") {
    return "Interval is required.";
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "Interval must be a whole number.";
  }
  if (!Number.isInteger(number)) {
    return "Interval must be a whole number.";
  }
  if (number < SENSOR_STREAM_MIN_INTERVAL_MS) {
    return "Interval must be at least 100 ms.";
  }
  if (number > SENSOR_STREAM_MAX_INTERVAL_MS) {
    return "Interval must not exceed 1000 ms.";
  }
  return null;
}

export function parseSensorStreamSnapshot(raw: unknown, expectedDeviceId?: string | null): SensorStreamSnapshot | null {
  try {
    if (!isRecord(raw)) {
      return null;
    }

  const deviceId = text(raw.deviceId) ?? text(raw.device_id);
  if (!deviceId || (expectedDeviceId && deviceId !== expectedDeviceId)) {
    return null;
  }

  const telemetryMode = text(raw.telemetryMode) ?? text(raw.telemetry_mode);
  if (telemetryMode !== "SENSOR_STREAM") {
    return null;
  }

  const snapshot: SensorStreamSnapshot = {
    deviceId,
    telemetryMode,
    state: text(raw.state) ?? "-",
    pressure0Kpa: finiteNumber(raw.pressure0Kpa ?? raw.pressure_0_kpa),
    pressure0KpaValid: requiredBoolean(raw.pressure0KpaValid ?? raw.pressure_0_kpa_valid),
    pressure1Kpa: finiteNumber(raw.pressure1Kpa ?? raw.pressure_1_kpa),
    pressure1KpaValid: requiredBoolean(raw.pressure1KpaValid ?? raw.pressure_1_kpa_valid),
    pressure2Kpa: finiteNumber(raw.pressure2Kpa ?? raw.pressure_2_kpa),
    pressure2KpaValid: requiredBoolean(raw.pressure2KpaValid ?? raw.pressure_2_kpa_valid),
    pressureKpaValid: requiredBoolean(raw.pressureKpaValid ?? raw.pressure_kpa_valid),
    hallMm: finiteNumber(raw.hallMm ?? raw.hall_mm),
    hallProgress: finiteNumber(raw.hallProgress ?? raw.hall_progress),
    hallMmValid: requiredBoolean(raw.hallMmValid ?? raw.hall_mm_valid),
    pressureSaturationMask: integer(raw.pressureSaturationMask ?? raw.pressure_saturation_mask),
    intervalMs: integer(raw.intervalMs ?? raw.interval_ms),
    firmwareTimestampMs: integer(raw.firmwareTimestampMs ?? raw.tsMs ?? raw.ts_ms),
    receivedAt: text(raw.receivedAt) ?? new Date().toISOString(),
  };

  if (snapshot.pressureSaturationMask < 0 || snapshot.pressureSaturationMask > 0b111) {
    return null;
  }

    return snapshot;
  } catch {
    return null;
  }
}

export function isSensorStreamTelemetry(raw: unknown): boolean {
  if (!isRecord(raw)) {
    return false;
  }
  return (text(raw.telemetryMode) ?? text(raw.telemetry_mode)) === "SENSOR_STREAM";
}

export function hasTelemetryMode(raw: unknown): boolean {
  if (!isRecord(raw)) {
    return false;
  }
  return Boolean(text(raw.telemetryMode) ?? text(raw.telemetry_mode));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Malformed sensor stream number");
  }
  return value;
}

function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error("Malformed sensor stream integer");
  }
  return value;
}

function requiredBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new Error("Malformed sensor stream boolean");
  }
  return value;
}
