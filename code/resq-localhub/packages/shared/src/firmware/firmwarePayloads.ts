import type { ActionId, EventId, ProgressId, ReasonId } from "./firmwareIds";
import type { FirmwareState } from "./firmwareStates";

export interface FirmwareStatusPayload {
  state: FirmwareState;
  session_active: boolean;
  session_id?: string;
  calibrated: boolean;
  last_error_id?: ReasonId;
  ip?: string;
  ts_ms: number;
}

export interface FirmwareHeartbeatPayload {
  state: FirmwareState;
  wifi_connected: boolean;
  mqtt_connected: boolean;
  backend_registered: boolean;
  session_active: boolean;
  sensor_running: boolean;
  session_id?: string;
  calibrated: boolean;
  uptime_ms?: number;
  ts_ms: number;
}

export interface FirmwareTelemetryPayload {
  session_id: string;
  state: "SESSION_ACTIVE";
  depth_progress?: number;
  depth_ok?: boolean;
  rate_cpm?: number;
  compression_count?: number;
  valid_compression_count?: number;
  recoil_ok_count?: number;
  incomplete_recoil_count?: number;
  pause_s?: number;
  hand_placement?: "CENTER" | "LEFT" | "RIGHT" | "UNKNOWN" | string;
  pressure_balance_pct?: number;
  flags?: string;
  ts_ms: number;
}

export interface FirmwareDebugPayload {
  pressure_0_raw?: number;
  pressure_1_raw?: number;
  pressure_2_raw?: number;
  hall_raw?: number;
  ts_ms: number;
}

export interface FirmwareCommandRequestPayload {
  request_id: string;
  issued_at_ms: number;
}

export interface FirmwareCalibrationStartCommandPayload extends FirmwareCommandRequestPayload {
  hall_delta: number;
  ref_pressure: number;
  bladder_1_pressure: number;
  bladder_2_pressure: number;
}

export interface FirmwareSessionStartCommandPayload extends FirmwareCommandRequestPayload {
  session_id: string;
  profile_id?: string;
}

export interface FirmwareSessionStopCommandPayload extends FirmwareCommandRequestPayload {
  session_id?: string;
}

export interface FirmwareEventBasePayload {
  event_id: EventId;
  state?: FirmwareState;
  ts_ms: number;
}

export interface FirmwareCommandReplyPayload {
  event_id: EventId;
  reply_id?: string;
  status: "ACK" | "NACK";
  state?: FirmwareState;
  reason_id?: ReasonId;
  action_id?: ActionId;
  ts_ms: number;
}

export interface FirmwareCalibrationEventPayload {
  event_id: 4000 | 4001 | 4002;
  reply_id?: string;
  status?: "ACK" | "NACK";
  result?: "PASS" | "PASS_WITH_WARNINGS" | "FAIL" | "CANCELLED";
  progress_id?: ProgressId;
  reason_id?: ReasonId;
  action_id?: ActionId;
  state?: FirmwareState;
  pressure_0_kpa?: number;
  pressure_0_kpa_valid?: boolean;
  pressure_1_kpa?: number;
  pressure_1_kpa_valid?: boolean;
  pressure_2_kpa?: number;
  pressure_2_kpa_valid?: boolean;
  pressure_kpa_valid?: boolean;
  hall_mm?: number;
  hall_progress?: number;
  hall_mm_valid?: boolean;
  sample_pressure_kpa_valid?: boolean;
  sample_hall_mm_valid?: boolean;
  pressure_saturation_mask?: number;
  full_depth_mm?: number;
  ts_ms: number;
}

export interface FirmwareErrorEventPayload {
  event_id: 5000 | 5001 | 5002;
  reply_id?: string;
  status?: "ACK" | "NACK";
  reason_id?: ReasonId;
  action_id?: ActionId;
  state?: FirmwareState;
  ts_ms: number;
}

export interface FirmwareSessionStartedEventPayload {
  event_id: 2000;
  reply_id?: string;
  status: "ACK";
  state: "SESSION_ACTIVE";
  session_id: string;
  ts_ms: number;
}

export interface FirmwareSessionStoppedEventPayload {
  event_id: 2001;
  reply_id?: string;
  status: "ACK";
  result?: "STOPPED" | "INTERRUPTED" | string;
  state?: FirmwareState;
  session_id: string;
  total_compressions?: number;
  valid_compressions?: number;
  recoil_ok_count?: number;
  incomplete_recoil_count?: number;
  ts_ms: number;
}
