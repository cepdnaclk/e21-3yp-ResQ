export interface ManikinStatusPayload {
  mac: string;
  ip: string;
  fw?: string;
  rssi?: number;
  battery?: number;
  ts: number;
  pairToken?: string; // only during pairing flow
}

export type PlacementState =
  | "BALANCED"
  | "LEFT_BIASED"
  | "RIGHT_BIASED"
  | "UNKNOWN";

export type TelemetryFlag =
  | "DEPTH_OK"
  | "DEPTH_LOW"
  | "DEPTH_HIGH"
  | "RATE_OK"
  | "RATE_LOW"
  | "RATE_HIGH"
  | "RECOIL_OK"
  | "LEANING"
  | "PAUSE_DETECTED"
  | "INTERRUPTION_DETECTED"
  | "PLACEMENT_OK"
  | "PLACEMENT_BAD";

export interface LiveTelemetryPayload {
  ts: number;
  depth_mm: number;
  rate_cpm: number;
  recoil_ok: boolean;
  pause_s: number;
  interruption: boolean;

  placement_state: PlacementState;
  placement_ok: boolean;

  flags: TelemetryFlag[];
}

export type EventType =
  | "COMPRESSION"
  | "PAUSE_STARTED"
  | "PAUSE_ENDED"
  | "INTERRUPTION_STARTED"
  | "INTERRUPTION_ENDED"
  | "PLACEMENT_BAD"
  | "PLACEMENT_RECOVERED"
  | "SESSION_START"
  | "SESSION_END";

export interface TelemetryEventPayload {
  ts: number;
  type: EventType;
  depth_mm?: number;
  rate_cpm?: number;
  recoil_ok?: boolean;
  pause_s?: number;
  placement_state?: PlacementState;
  valueJson?: Record<string, unknown>;
}