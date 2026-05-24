export const FIRMWARE_STATES = [
  "BOOT",
  "CONFIG_CHECK",
  "PROVISIONING",
  "FLUSH_CONFIG",
  "WIFI_CONNECTING",
  "BACKEND_REGISTERING",
  "MQTT_CONNECTING",
  "PAIRED_IDLE",
  "CALIBRATING",
  "CALIBRATION_FAIL",
  "READY_FOR_SESSION",
  "SESSION_ACTIVE",
  "SESSION_INTERRUPTED",
  "ERROR",
  "RESETTING",
  "TURN_OFF",
] as const;

export type FirmwareState = (typeof FIRMWARE_STATES)[number];

const FIRMWARE_STATE_SET = new Set<string>(FIRMWARE_STATES);

export function isFirmwareState(value: unknown): value is FirmwareState {
  return typeof value === "string" && FIRMWARE_STATE_SET.has(value);
}