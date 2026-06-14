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
  const res = await getJson<any>(devicePath(deviceId, "/readiness"));
  return {
    ...res,
    ready: res.readyForSession,
    source: res.source || null,
  };
}

/** GET /api/firmware/devices/{deviceId}/calibration/latest */
export async function fetchLatestCalibration(deviceId: string): Promise<FirmwareReadinessResponse> {
  const res = await getJson<any>(devicePath(deviceId, "/calibration/latest"));
  return {
    ...res,
    ready: res.readyForSession,
    source: res.source || null,
  };
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
  const res = await getJson<any>(devicePath(deviceId, "/diagnostics"));
  
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

/** POST /api/firmware/devices/{deviceId}/debug — request a debug snapshot from device */
export async function requestDebugSnapshot(deviceId: string): Promise<FirmwareCalibrationCommandResponse> {
  return postJson<FirmwareCalibrationCommandResponse>(devicePath(deviceId, "/debug"));
}
