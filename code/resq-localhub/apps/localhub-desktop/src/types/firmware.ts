/**
 * firmware.ts — Firmware/calibration types for V2.
 * These types are only used in TechnicianDiagnosticsPage and ManikinReadinessPage.
 *
 * All fields here contain diagnostic or technical data.
 * Do NOT render these on normal instructor/trainee screens.
 */

export type FirmwareReadinessResponse = {
  deviceId: string;
  ready: boolean;
  calibrated: boolean | null;
  lastCalibrationAt: string | null;
  profileId: string | null;
  profileName: string | null;
  notes: string | null;
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
  payload: unknown;
  receivedAt: string;
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
};
