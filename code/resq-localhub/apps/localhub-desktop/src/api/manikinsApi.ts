/**
 * manikinsApi.ts — V2 manikin API.
 * Fixes the port-8080 bug from browserManikinsApi.ts.
 * All requests go through localHubClient which uses port 18080.
 */

import { getJson, postJson } from "./localHubClient";
import type {
  ManikinLiveSummary,
  ManikinPairTokenResponse,
  DeviceReadinessState,
  CalibrationStartRequest,
  CalibrationCommandResponse,
  CalibrationEvidence,
  CalibrationEvidenceDetail,
} from "../types/manikin";

/** GET /api/manikins — full registry of all known devices */
export async function fetchManikins(): Promise<ManikinLiveSummary[]> {
  return getJson<ManikinLiveSummary[]>("/api/manikins");
}

/** GET /api/manikins/live — live snapshots of all devices */
export async function fetchLiveManikins(): Promise<ManikinLiveSummary[]> {
  return getJson<ManikinLiveSummary[]>("/api/manikins/live");
}

/** GET /api/manikins/live/{deviceId} — live snapshot for one device */
export async function fetchLiveManikin(deviceId: string): Promise<ManikinLiveSummary> {
  return getJson<ManikinLiveSummary>(`/api/manikins/live/${encodeURIComponent(deviceId)}`);
}

/**
 * POST /api/manikins/pair-request — request a pairing token for a device.
 * NOTE: Token generation is implemented but validation is not yet enforced by firmware.
 */
export async function requestPairingToken(deviceId: string): Promise<ManikinPairTokenResponse> {
  return postJson<ManikinPairTokenResponse>("/api/manikins/pair-request", { deviceId });
}

/** GET /api/devices/{deviceId}/readiness */
export async function getDeviceReadiness(deviceId: string): Promise<DeviceReadinessState> {
  return getJson<DeviceReadinessState>(`/api/devices/${encodeURIComponent(deviceId)}/readiness`);
}

/** POST /api/devices/{deviceId}/calibration/start */
export async function startCalibration(
  deviceId: string,
  request: CalibrationStartRequest,
): Promise<CalibrationCommandResponse> {
  return postJson<CalibrationCommandResponse>(
    `/api/devices/${encodeURIComponent(deviceId)}/calibration/start`,
    request,
  );
}

/** POST /api/devices/{deviceId}/calibration/cancel */
export async function cancelCalibration(
  deviceId: string,
): Promise<CalibrationCommandResponse> {
  return postJson<CalibrationCommandResponse>(
    `/api/devices/${encodeURIComponent(deviceId)}/calibration/cancel`,
  );
}

/** GET /api/devices/{deviceId}/calibration/latest */
export async function getLatestCalibrationEvidence(deviceId: string): Promise<CalibrationEvidence | null> {
  return getJson<CalibrationEvidence | null>(`/api/devices/${encodeURIComponent(deviceId)}/calibration/latest`);
}

/** GET /api/devices/{deviceId}/calibration/history */
export async function getCalibrationHistory(deviceId: string, limit?: number): Promise<CalibrationEvidence[]> {
  const query = limit !== undefined ? `?limit=${limit}` : "";
  return getJson<CalibrationEvidence[]>(`/api/devices/${encodeURIComponent(deviceId)}/calibration/history${query}`);
}

/** GET /api/devices/{deviceId}/calibration/history/{evidenceId} */
export async function getCalibrationEvidence(deviceId: string, evidenceId: number): Promise<CalibrationEvidenceDetail> {
  return getJson<CalibrationEvidenceDetail>(`/api/devices/${encodeURIComponent(deviceId)}/calibration/history/${evidenceId}`);
}
