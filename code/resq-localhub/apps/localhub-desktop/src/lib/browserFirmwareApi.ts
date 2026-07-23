import { getHubApiBaseUrl } from "./hubApiUrl";
import type { DeviceReadinessState } from "../types/manikin";

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

export type FirmwareCommandRequestRecord = {
  requestId: string;
  deviceId: string;
  commandTypeId: number;
  commandName: string;
  topic: string;
  payloadJson: string;
  status: string;
  replyId: string | null;
  replyEventId: number | null;
  replyStatus: string | null;
  replyPayloadJson: string | null;
  reasonId: string | null;
  actionId: number | null;
  createdAt: string;
  publishedAt: string | null;
  completedAt: string | null;
  timeoutAt: string | null;
  lastUpdatedAt: string;
};

export type FirmwareEventRecord = {
  id: number;
  deviceId: string;
  topic: string;
  topicFamily: string;
  eventId: number | null;
  replyId: string | null;
  requestId: string | null;
  status: string | null;
  result: string | null;
  reasonId: string | null;
  actionId: number | null;
  progressId: number | null;
  firmwareState: string | null;
  sessionId: string | null;
  tsMs: number | null;
  receivedAt: string;
  payloadJson: string;
};

export type FirmwareDebugSnapshotRecord = {
  id: number;
  deviceId: string;
  requestId: string | null;
  pressure0Raw: number | null;
  pressure1Raw: number | null;
  pressure2Raw: number | null;
  hallRaw: number | null;
  tsMs: number | null;
  receivedAt: string;
  payloadJson: string;
};

export type FirmwareCommandPublishResponse = {
  deviceId: string;
  requestId: string;
  topic: string;
  status: string;
  message?: string | null;
};

export type FirmwareDeviceDiagnosticsResponse = {
  deviceId: string;
  readiness: DeviceReadinessState;
  latestCalibration: {
    id: number;
    deviceId: string;
    profileId: string | null;
    requestId: string | null;
    replyId: string | null;
    eventId: number | null;
    result: string | null;
    status: string | null;
    progressId: number | null;
    reasonId: string | null;
    actionId: number | null;
    firmwareState: string | null;
    calibrated: boolean | null;
    tsMs: number | null;
    receivedAt: string;
    payloadJson: string;
  } | null;
  liveSummary: {
    deviceId: string;
    online: boolean;
    lastSeen: string | null;
    state: string | null;
    ip: string | null;
    fw: string | null;
    rssi: number | null;
    battery: number | null;
    sessionActive: boolean | null;
    firmwareState?: string | null;
    calibrated?: boolean | null;
    readyForSession?: boolean | null;
    calibrationState?: string | null;
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
    lastErrorId?: string | null;
    latestDepthMm: number | null;
    latestDepthProgress?: number | null;
    latestCompressionCount?: number | null;
    latestRateCpm: number | null;
    latestRecoilOk: boolean | null;
    latestPauseS: number | null;
    latestFlags: string | null;
    lastEventType: string | null;
    latestForce1: number | null;
    latestForce2: number | null;
    pressureBalancePct: number | null;
    pressureSkewed: boolean | null;
    activeSessionId: string | null;
    activeTraineeId: string | null;
    activeSessionStartedAt: string | null;
    activeSessionScenario: string | null;
  } | null;
  recentCommands: FirmwareCommandRequestRecord[];
  recentEvents: FirmwareEventRecord[];
  recentDebugSnapshots: FirmwareDebugSnapshotRecord[];
};

function getFirmwareDeviceUrl(deviceId: string): string {
  return `${getHubApiBaseUrl()}/api/devices/${encodeURIComponent(deviceId)}/firmware`;
}

function getCalibrationProfilesUrl(): string {
  return `${getHubApiBaseUrl()}/api/firmware/calibration-profiles`;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const data: unknown = await response.json();
  return data as T;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const errorResponse = await readJsonResponse<{ error?: string; message?: string }>(response).catch(() => null);
    throw new Error(errorResponse?.error ?? errorResponse?.message ?? `Firmware request failed (${response.status})`);
  }

  return readJsonResponse<T>(response);
}

export function getCalibrationProfiles(): Promise<CalibrationProfileResponse[]> {
  return requestJson<CalibrationProfileResponse[]>(getCalibrationProfilesUrl());
}

export function getDefaultCalibrationProfile(): Promise<CalibrationProfileResponse | null> {
  return requestJson<CalibrationProfileResponse | null>(`${getCalibrationProfilesUrl()}/default`);
}

export function createCalibrationProfile(profile: CalibrationProfileRequest): Promise<CalibrationProfileResponse> {
  return requestJson<CalibrationProfileResponse>(getCalibrationProfilesUrl(), {
    method: "POST",
    body: JSON.stringify(profile),
  });
}

export function updateCalibrationProfile(profileId: string, profile: CalibrationProfileRequest): Promise<CalibrationProfileResponse> {
  return requestJson<CalibrationProfileResponse>(`${getCalibrationProfilesUrl()}/${encodeURIComponent(profileId)}`, {
    method: "PUT",
    body: JSON.stringify(profile),
  });
}

export function setDefaultCalibrationProfile(profileId: string): Promise<CalibrationProfileResponse> {
  return requestJson<CalibrationProfileResponse>(`${getCalibrationProfilesUrl()}/${encodeURIComponent(profileId)}/default`, {
    method: "POST",
  });
}

export function deactivateCalibrationProfile(profileId: string): Promise<CalibrationProfileResponse> {
  return requestJson<CalibrationProfileResponse>(`${getCalibrationProfilesUrl()}/${encodeURIComponent(profileId)}`, {
    method: "DELETE",
  });
}

export function getFirmwareCommands(deviceId: string, limit?: number): Promise<FirmwareCommandRequestRecord[]> {
  const suffix = limit === undefined ? "" : `?limit=${encodeURIComponent(limit)}`;
  return requestJson<FirmwareCommandRequestRecord[]>(`${getFirmwareDeviceUrl(deviceId)}/commands${suffix}`);
}

export function getFirmwareEvents(deviceId: string, limit?: number): Promise<FirmwareEventRecord[]> {
  const suffix = limit === undefined ? "" : `?limit=${encodeURIComponent(limit)}`;
  return requestJson<FirmwareEventRecord[]>(`${getFirmwareDeviceUrl(deviceId)}/events${suffix}`);
}

export function getFirmwareDebugSnapshots(deviceId: string, limit?: number): Promise<FirmwareDebugSnapshotRecord[]> {
  const suffix = limit === undefined ? "" : `?limit=${encodeURIComponent(limit)}`;
  return requestJson<FirmwareDebugSnapshotRecord[]>(`${getFirmwareDeviceUrl(deviceId)}/debug-snapshots${suffix}`);
}

export function getFirmwareDiagnostics(deviceId: string): Promise<FirmwareDeviceDiagnosticsResponse> {
  return requestJson<FirmwareDeviceDiagnosticsResponse>(`${getFirmwareDeviceUrl(deviceId)}/diagnostics`);
}

export function requestFirmwareDebugSnapshot(deviceId: string): Promise<FirmwareCommandPublishResponse> {
  return requestJson<FirmwareCommandPublishResponse>(`${getFirmwareDeviceUrl(deviceId)}/debug`, {
    method: "POST",
  });
}
