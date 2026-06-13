/**
 * firmwareApi.ts — V2 firmware/calibration/diagnostics API.
 * Only used in TechnicianDiagnosticsPage and ManikinReadinessPage.
 */

import { getJson, postJson } from "./localHubClient";
import type {
  FirmwareReadinessResponse,
  FirmwareCalibrationCommandResponse,
  FirmwareDeviceDiagnosticsResponse,
  FirmwareCalibrationStartRequest,
} from "../types/firmware";

function devicePath(deviceId: string, suffix: string): string {
  return `/api/firmware/devices/${encodeURIComponent(deviceId)}${suffix}`;
}

/** GET /api/firmware/devices/{deviceId}/readiness */
export async function fetchDeviceReadiness(deviceId: string): Promise<FirmwareReadinessResponse> {
  return getJson<FirmwareReadinessResponse>(devicePath(deviceId, "/readiness"));
}

/** GET /api/firmware/devices/{deviceId}/calibration/latest */
export async function fetchLatestCalibration(deviceId: string): Promise<FirmwareReadinessResponse> {
  return getJson<FirmwareReadinessResponse>(devicePath(deviceId, "/calibration/latest"));
}

/** POST /api/firmware/devices/{deviceId}/calibration/start */
export async function startCalibration(
  deviceId: string,
  request?: FirmwareCalibrationStartRequest,
): Promise<FirmwareCalibrationCommandResponse> {
  return postJson<FirmwareCalibrationCommandResponse>(
    devicePath(deviceId, "/calibration/start"),
    request ?? {},
  );
}

/** POST /api/firmware/devices/{deviceId}/calibration/cancel */
export async function cancelCalibration(deviceId: string): Promise<FirmwareCalibrationCommandResponse> {
  return postJson<FirmwareCalibrationCommandResponse>(devicePath(deviceId, "/calibration/cancel"));
}

/** GET /api/firmware/devices/{deviceId}/diagnostics — full diagnostics bundle */
export async function fetchDeviceDiagnostics(deviceId: string): Promise<FirmwareDeviceDiagnosticsResponse> {
  return getJson<FirmwareDeviceDiagnosticsResponse>(devicePath(deviceId, "/diagnostics"));
}

/** POST /api/firmware/devices/{deviceId}/debug — request a debug snapshot from device */
export async function requestDebugSnapshot(deviceId: string): Promise<FirmwareCalibrationCommandResponse> {
  return postJson<FirmwareCalibrationCommandResponse>(devicePath(deviceId, "/debug"));
}
