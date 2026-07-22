/**
 * firmwareApi.ts — V2 firmware/calibration/diagnostics API.
 * Only used in TechnicianDiagnosticsPage and ManikinReadinessPage.
 */

import { getJson, postJson } from "./localHubClient";
import type {
  DeviceReadinessState,
  CalibrationCommandResponse,
  FirmwareDeviceDiagnosticsResponse,
  CalibrationStartRequest,
  CalibrationProfileResponse,
} from "../types/firmware";

/** GET /api/firmware/calibration-profiles */
export async function getCalibrationProfiles(): Promise<CalibrationProfileResponse[]> {
  return getJson<CalibrationProfileResponse[]>("/api/firmware/calibration-profiles");
}

/** GET /api/firmware/calibration-profiles/default */
export async function getDefaultCalibrationProfile(): Promise<CalibrationProfileResponse | null> {
  return getJson<CalibrationProfileResponse | null>("/api/firmware/calibration-profiles/default");
}

function devicePath(deviceId: string, suffix: string): string {
  return `/api/devices/${encodeURIComponent(deviceId)}${suffix}`;
}

function firmwareDevicePath(deviceId: string, suffix: string): string {
  return `/api/devices/${encodeURIComponent(deviceId)}/firmware${suffix}`;
}

/** GET /api/devices/{deviceId}/readiness */
export async function fetchDeviceReadiness(deviceId: string): Promise<DeviceReadinessState> {
  return getJson<DeviceReadinessState>(devicePath(deviceId, "/readiness"));
}

/** GET /api/devices/{deviceId}/calibration/latest */
export async function fetchLatestCalibration(deviceId: string): Promise<unknown> {
  return getJson<unknown>(devicePath(deviceId, "/calibration/latest"));
}

/** POST /api/devices/{deviceId}/calibration/start */
export async function startCalibration(
  deviceId: string,
  request: CalibrationStartRequest,
): Promise<CalibrationCommandResponse> {
  return postJson<CalibrationCommandResponse>(
    devicePath(deviceId, "/calibration/start"),
    request,
  );
}

/** POST /api/devices/{deviceId}/calibration/cancel */
export async function cancelCalibration(deviceId: string): Promise<CalibrationCommandResponse> {
  return postJson<CalibrationCommandResponse>(devicePath(deviceId, "/calibration/cancel"));
}

/** GET /api/devices/{deviceId}/firmware/diagnostics — full diagnostics bundle */
export async function fetchDeviceDiagnostics(deviceId: string): Promise<FirmwareDeviceDiagnosticsResponse> {
  const res = await getJson<any>(firmwareDevicePath(deviceId, "/diagnostics"));
  
  const rawSnapshots = res.recentDebugSnapshots || [];
  const debugSnapshots = rawSnapshots.map((snap: any) => {
    let parsedPayload = null;
    if (snap.payloadJson) {
      try {
        parsedPayload = JSON.parse(snap.payloadJson);
      } catch (e) {
        console.warn("Failed to parse payloadJson on snapshot", snap.id, e);
      }
    }
    return {
      id: String(snap.id),
      deviceId: snap.deviceId,
      requestId: snap.requestId || null,
      pressure0Raw: snap.pressure0Raw !== undefined ? snap.pressure0Raw : null,
      pressure1Raw: snap.pressure1Raw !== undefined ? snap.pressure1Raw : null,
      pressure2Raw: snap.pressure2Raw !== undefined ? snap.pressure2Raw : null,
      hallRaw: snap.hallRaw !== undefined ? snap.hallRaw : null,
      tsMs: snap.tsMs !== undefined ? snap.tsMs : null,
      receivedAt: snap.receivedAt,
      payloadJson: snap.payloadJson || "",
      payload: parsedPayload || {},
    };
  });

  return {
    ...res,
    debugSnapshots,
  };
}

/** POST /api/devices/{deviceId}/firmware/debug — request a debug snapshot from device */
export async function requestDebugSnapshot(deviceId: string): Promise<CalibrationCommandResponse> {
  return postJson<CalibrationCommandResponse>(firmwareDevicePath(deviceId, "/debug"));
}
