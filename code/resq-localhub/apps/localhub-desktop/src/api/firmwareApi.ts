/**
 * firmwareApi.ts — V2 firmware/calibration/diagnostics API.
 * Only used in TechnicianDiagnosticsPage and ManikinReadinessPage.
 */

import { getJson, postJson } from "./localHubClient";
import type {
  FirmwareCommandPublishResponse,
  FirmwareDeviceDiagnosticsResponse,
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

function firmwareDevicePath(deviceId: string, suffix: string): string {
  return `/api/devices/${encodeURIComponent(deviceId)}/firmware${suffix}`;
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
export async function requestDebugSnapshot(deviceId: string): Promise<FirmwareCommandPublishResponse> {
  return postJson<FirmwareCommandPublishResponse>(firmwareDevicePath(deviceId, "/debug"));
}
