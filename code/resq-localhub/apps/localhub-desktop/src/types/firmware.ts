/**
 * firmware.ts — Firmware/calibration types for V2.
 * These types are only used in TechnicianDiagnosticsPage and ManikinReadinessPage.
 *
 * All fields here contain diagnostic or technical data.
 * Do NOT render these on normal instructor/trainee screens.
 */

import type { DeviceReadinessState } from "./manikin";

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
  readiness: DeviceReadinessState | null;
  latestCalibration: CalibrationResultRecord | null;
  liveSummary: import("./manikin").ManikinLiveSummary | null;
  recentCommands: FirmwareCommandRecord[];
  recentEvents: FirmwareEventRecord[];
  debugSnapshots: FirmwareDebugSnapshotRecord[];
};

export type FirmwareCommandPublishResponse = {
  deviceId: string;
  requestId: string;
  topic: string;
  status: string;
  message?: string | null;
};

export type CalibrationProfileRequest = {
  name: string;
  hallDelta: number;
  refPressure: number;
  bladder1Pressure: number;
  bladder2Pressure: number;
  description?: string | null;
  active?: boolean | null;
  defaultProfile?: boolean | null;
};

export type CalibrationProfileResponse = {
  profileId: string;
  name: string;
  hallDelta: number;
  refPressure: number;
  bladder1Pressure: number;
  bladder2Pressure: number;
  description: string | null;
  active: boolean;
  defaultProfile: boolean;
  createdAt: string;
  updatedAt: string;
};
