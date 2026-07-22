/**
 * manikin.ts — Manikin device types for V2.
 *
 * Fields marked @diagnostic should NOT be displayed on normal instructor/trainee screens.
 * They are only for the TechnicianDiagnosticsPage.
 */

export type ManikinLiveSummary = {
  deviceId: string;
  sessionId: string | null;
  manikinId: string | null;
  online: boolean;
  lastSeen: string | null;

  /** Firmware device state. Use getDeviceStateLabel() to get user-friendly text. */
  state: string | null;

  /** @diagnostic — IP address: show only in diagnostics */
  ip: string | null;
  /** @diagnostic — Firmware version string */
  fw: string | null;
  /** @diagnostic — Wi-Fi signal strength (dBm) */
  rssi: number | null;
  /** @diagnostic — Battery percentage */
  battery: number | null;

  sessionActive: boolean | null;

  /** Latest compression depth in millimetres */
  latestDepthMm: number | null;
  latestDepthProgress: number | null;
  latestCompressionCount: number | null;
  /** Latest compression rate (compressions per minute) */
  latestRateCpm: number | null;
  latestRecoilOk: boolean | null;
  latestPauseS: number | null;
  /** Raw firmware flags string. Use getFlagMessages() to display. */
  latestFlags: string | null;
  lastEventType: string | null;

  /** @diagnostic — Raw force sensor readings */
  latestForce1: number | null;
  /** @diagnostic — Raw force sensor readings */
  latestForce2: number | null;

  pressureBalancePct: number | null;
  pressureSkewed: boolean | null;
  firmwareState?: string | null;
  calibrated?: boolean | null;
  readyForSession?: boolean | null;
  calibrationState?: CalibrationState | string | null;
  progressId?: number | null;
  reasonId?: string | null;
  actionId?: number | null;
  calibrationProgressId?: number | null;
  calibrationReasonId?: string | null;
  calibrationActionId?: number | null;
  calibrationResult?: string | null;
  profileId?: string | null;
  pressureMode?: string | null;
  pressureDegraded?: boolean | null;
  usingLastStablePressure?: boolean | null;
  pressureValid?: boolean | null;
  hallValid?: boolean | null;
  depthSource?: string | null;
  warnings?: string | null;

  /** Session context fields (null when no active session) */
  activeSessionId: string | null;
  activeTraineeId: string | null;
  activeSessionStartedAt: string | null;
  activeSessionScenario: string | null;
  activeSessionLifecycleState?: import("./session").SessionLifecycleState | null;

  latestMetric: import("./live").LiveMetricPayload | null;
  seq: number | null;

  /** Connection state. Use getConnectionStateLabel() to display. */
  connectionState: string | null;
  stale: boolean;
  offline: boolean;
};

export type ManikinInventoryStatus =
  | "paired"
  | "pending"
  | "online"
  | "offline"
  | "stale"
  | "unknown";

export type ManikinInventoryEntry = ManikinLiveSummary & {
  status: ManikinInventoryStatus;
  rawStatus: string | null;
};

export type ManikinPairTokenResponse = {
  deviceId: string;
  token: string;
  expiresAt: string;
};

export type CalibrationState =
  | "UNKNOWN"
  | "IDLE"
  | "NOT_READY"
  | "STARTING"
  | "RUNNING"
  | "CANCELLING"
  | "CALIBRATING"
  | "PASSED"
  | "READY"
  | "FAILED"
  | "INTERRUPTED"
  | "CANCELLED"
  | "ERROR";

export type DeviceReadinessState = {
  deviceId: string;
  calibrationState: CalibrationState;
  firmwareState?: string | null;
  currentProgressId?: number | null;
  lastReasonId?: string | null;
  lastActionId?: number | null;
  lastResult?: string | null;
  lastReplyId?: string | null;
  readyForSession: boolean;
  lastUpdatedAt?: string | null;
  calibrationSchemaVersion?: number | null;
  calibrationGeneration?: number | null;
  calibrationStorageStatus?: string | null;
  recalibrationRequired?: boolean | null;
  profileVersion?: number | null;
  profileHash?: string | null;
};

export type CalibrationStartRequest = {
  hall_delta: number;
  ref_pressure: number;
  bladder_1_pressure: number;
  bladder_2_pressure: number;
  profile_id?: string;
  sample_interval_ms?: number;
  calibration_window_ms?: number;
  full_depth_mm?: number;
  pressure_0_kpa_per_count?: number;
  pressure_1_kpa_per_count?: number;
  pressure_2_kpa_per_count?: number;
  profile_version?: number;
  profile_hash?: string;
};

export type CalibrationCommandResponse = {
  deviceId: string;
  requestId: string;
  command: string;
  status: string;
  message?: string;
  issuedAt?: string;
};

export type CalibrationStreamEvent = {
  type: string;
  deviceId: string;
  eventId: number | null;
  replyId: string | null;
  status: string | null;
  progressId: number | null;
  result: string | null;
  reasonId: string | null;
  actionId: number | null;
  firmwareState: string | null;
  calibrationState: CalibrationState;
  readyForSession: boolean;
  tsMs: number | null;
  receivedAt: string | null;
  readiness: DeviceReadinessState | null;
  pressure0Kpa?: number | null;
  pressure0KpaValid?: boolean | null;
  pressure1Kpa?: number | null;
  pressure1KpaValid?: boolean | null;
  pressure2Kpa?: number | null;
  pressure2KpaValid?: boolean | null;
  pressureKpaValid?: boolean | null;
  hallMm?: number | null;
  hallProgress?: number | null;
  hallMmValid?: boolean | null;
  samplePressureKpaValid?: boolean | null;
  sampleHallMmValid?: boolean | null;
  pressureSaturationMask?: number | null;
  fullDepthMm?: number | null;
  pressure0Raw?: number | null;
  pressure0RawValid?: boolean | null;
  pressure1Raw?: number | null;
  pressure1RawValid?: boolean | null;
  pressure2Raw?: number | null;
  pressure2RawValid?: boolean | null;
  hallRaw?: number | null;
  hallRawValid?: boolean | null;
  hallBaselineRaw?: number | null;
  hallBaselineRawValid?: boolean | null;
};

export type CalibrationEvidence = {
  id: number;
  deviceId: string;
  requestId: string;
  startedAt: string;
  completedAt: string | null;
  finalResult: "RUNNING" | "PASS" | "FAIL" | "CANCELLED" | "INTERRUPTED" | "UNKNOWN" | string | null;
  calibrationState: string | null;
  readyForSessionAtCompletion: boolean | null;
  lastProgressId: number | null;
  lastReasonId: string | null;
  lastActionId: number | null;
  firmwareState: string | null;
  profileId: string | null;
  hallDelta: number | null;
  refPressure: number | null;
  bladder1Pressure: number | null;
  bladder2Pressure: number | null;
  sampleIntervalMs: number | null;
  calibrationWindowMs: number | null;
  createdByUsername: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CalibrationEventLog = {
  id: number;
  deviceId: string;
  requestId: string | null;
  eventId: number | null;
  progressId: number | null;
  result: string | null;
  status: string | null;
  reasonId: string | null;
  actionId: number | null;
  firmwareState: string | null;
  tsMs: number | null;
  receivedAt: string;
  rawPayloadJson: string | null;
};

export type CalibrationEvidenceDetail = {
  evidence: CalibrationEvidence;
  logs: CalibrationEventLog[];
};
