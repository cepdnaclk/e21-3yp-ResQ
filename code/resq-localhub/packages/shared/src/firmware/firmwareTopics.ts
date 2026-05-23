export type FirmwareTopicFamily =
  | "status"
  | "heartbeat"
  | "telemetry"
  | "debug"
  | "events"
  | "events/calibration"
  | "events/error"
  | "cmd";

export type ParsedFirmwareTopic = {
  valid: boolean;
  namespace: "resq";
  deviceId?: string;
  family?: FirmwareTopicFamily;
  command?: string;
  segments: string[];
};

function normalizeSegment(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

function joinTopic(...segments: string[]): string {
  return segments.map(normalizeSegment).filter((segment) => segment.length > 0).join("/");
}

function buildDeviceTopic(deviceId: string, suffix?: string): string {
  return suffix ? joinTopic("resq", deviceId, suffix) : joinTopic("resq", deviceId);
}

export function buildFirmwareBaseTopic(deviceId: string): string {
  return buildDeviceTopic(deviceId);
}

export function buildFirmwareStatusTopic(deviceId: string): string {
  return buildDeviceTopic(deviceId, "status");
}

export function buildFirmwareHeartbeatTopic(deviceId: string): string {
  return buildDeviceTopic(deviceId, "heartbeat");
}

export function buildFirmwareTelemetryTopic(deviceId: string): string {
  return buildDeviceTopic(deviceId, "telemetry");
}

export function buildFirmwareDebugTopic(deviceId: string): string {
  return buildDeviceTopic(deviceId, "debug");
}

export function buildFirmwareEventsTopic(deviceId: string): string {
  return buildDeviceTopic(deviceId, "events");
}

export function buildFirmwareCalibrationEventsTopic(deviceId: string): string {
  return buildDeviceTopic(deviceId, "events/calibration");
}

export function buildFirmwareErrorEventsTopic(deviceId: string): string {
  return buildDeviceTopic(deviceId, "events/error");
}

export function buildFirmwareCommandTopic(deviceId: string, command: string): string {
  return buildDeviceTopic(deviceId, command);
}

export function buildDebugCommandTopic(deviceId: string): string {
  return buildFirmwareCommandTopic(deviceId, "cmd/debug");
}

export function buildCalibrationStartCommandTopic(deviceId: string): string {
  return buildFirmwareCommandTopic(deviceId, "cmd/calibration/start");
}

export function buildCalibrationCancelCommandTopic(deviceId: string): string {
  return buildFirmwareCommandTopic(deviceId, "cmd/calibration/cancel");
}

export function buildSessionStartCommandTopic(deviceId: string): string {
  return buildFirmwareCommandTopic(deviceId, "cmd/session/start");
}

export function buildSessionStopCommandTopic(deviceId: string): string {
  return buildFirmwareCommandTopic(deviceId, "cmd/session/stop");
}

export function buildSystemRetryCommandTopic(deviceId: string): string {
  return buildFirmwareCommandTopic(deviceId, "cmd/system/retry");
}

export function buildSystemResetCommandTopic(deviceId: string): string {
  return buildFirmwareCommandTopic(deviceId, "cmd/system/reset");
}

export function buildSystemFlushConfigCommandTopic(deviceId: string): string {
  return buildFirmwareCommandTopic(deviceId, "cmd/system/flush-config");
}

export function parseFirmwareTopic(topic: string): ParsedFirmwareTopic {
  const segments = topic.split("/").map(normalizeSegment).filter((segment) => segment.length > 0);
  const parsed: ParsedFirmwareTopic = { valid: false, namespace: "resq", segments };

  if (segments.length < 3 || segments[0] !== "resq") {
    return parsed;
  }

  parsed.deviceId = segments[1];

  const family = segments[2];
  if (family === "events" && segments.length === 4) {
    const eventFamily = segments[3];
    if (eventFamily === "calibration" || eventFamily === "error") {
      parsed.family = `events/${eventFamily}`;
      parsed.valid = true;
      return parsed;
    }
  }

  if (family === "cmd") {
    parsed.family = "cmd";
    parsed.command = segments.slice(3).join("/") || undefined;
    parsed.valid = segments.length >= 4 && Boolean(parsed.command);
    return parsed;
  }

  if (family === "status" || family === "heartbeat" || family === "telemetry" || family === "debug" || family === "events") {
    parsed.family = family;
    parsed.valid = segments.length === 3;
  }

  return parsed;
}