/**
 * firmware.ts — Firmware/calibration types for V2.
 * These types are only used in TechnicianDiagnosticsPage and ManikinReadinessPage.
 *
 * All fields here contain diagnostic or technical data.
 * Do NOT render these on normal instructor/trainee screens.
 */

export type FirmwareReadinessResponse = {
  deviceId: string;
  firmwareState: string | null;
  calibrated: boolean;
  readyForSession: boolean;
  ready: boolean; // mapped from readyForSession
  latestResult: string | null;
  progressId: number | null;
  reasonId: string | null;
  actionId: number | null;
  tsMs: number | null;
  receivedAt: string | null;
  sessionId?: string | null;
  lastErrorId?: string | null;
  source?: "FIRMWARE_READY_STATE" | "BACKEND_CALIBRATION_PASS" | "NOT_READY" | string;
};

export type FirmwareCalibrationCommandResponse = {
  deviceId: string;
  requestId: string;
  topic: string;
  status: string;
  error: string | null;
};

export type FirmwareCommandRecord = {
  id: string;
  deviceId: string;
  command: string;
  requestId: string;
  topic: string;
  payload: unknown;
  publishedAt: string;
};

export type FirmwareEventRecord = {
  id: string;
  deviceId: string;
  eventType: string;
  eventId: string | null;
  payload: unknown;
  receivedAt: string;
};

export type FirmwareDebugSnapshotRecord = {
  id: string;
  deviceId: string;
  requestId: string | null;
  pressure0Raw: number | null;
  pressure1Raw: number | null;
  pressure2Raw: number | null;
  hallRaw: number | null;
  tsMs: number | null;
  receivedAt: string;
  payloadJson: string;
  payload: unknown;
};

export type CalibrationResultRecord = {
  deviceId: string;
  result: string;
  receivedAt: string;
  payload: unknown;
};

export type FirmwareDeviceDiagnosticsResponse = {
  deviceId: string;
  readiness: FirmwareReadinessResponse | null;
  latestCalibration: CalibrationResultRecord | null;
  liveSummary: import("./manikin").ManikinLiveSummary | null;
  recentCommands: FirmwareCommandRecord[];
  recentEvents: FirmwareEventRecord[];
  debugSnapshots: FirmwareDebugSnapshotRecord[];
};

export type CalibrationProfileRequest = {
  name: string;
  depthTargetMm?: number | null;
  rateTargetCpm?: number | null;
  notes?: string | null;
};

export type CalibrationProfileResponse = {
  profileId: string;
  name: string;
  depthTargetMm: number | null;
  rateTargetCpm: number | null;
  notes: string | null;
  isDefault: boolean;
  createdAt: string;
};

export type FirmwareCalibrationStartRequest = {
  profileId?: string | null;
  hallDelta?: number | null;
  refPressure?: number | null;
  bladder1Pressure?: number | null;
  bladder2Pressure?: number | null;
};
