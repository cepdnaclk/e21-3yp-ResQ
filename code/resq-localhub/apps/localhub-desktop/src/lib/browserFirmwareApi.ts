export type FirmwareCalibrationStartPayload = {
  hallDelta: number;
  refPressure: number;
  bladder1Pressure: number;
  bladder2Pressure: number;
  profileId?: string | null;
};

export type FirmwareCalibrationCommandResponse = {
  deviceId: string;
  requestId: string;
  topic: string;
  status: string;
  message?: string | null;
};

export type FirmwareReadinessResponse = {
  deviceId: string;
  firmwareState: string | null;
  calibrated: boolean;
  readyForSession: boolean;
  latestResult: string | null;
  progressId: number | null;
  reasonId: string | null;
  actionId: number | null;
  tsMs: number | null;
  receivedAt: string | null;
  sessionId?: string | null;
  lastErrorId?: string | null;
};

const DEFAULT_CALIBRATION_PAYLOAD: FirmwareCalibrationStartPayload = {
  hallDelta: 13500,
  refPressure: 20100,
  bladder1Pressure: 15000,
  bladder2Pressure: 15000,
  profileId: "default",
};

function getFirmwareDeviceUrl(deviceId: string): string {
  return `http://${window.location.hostname}:18080/api/firmware/devices/${encodeURIComponent(deviceId)}`;
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

export function defaultCalibrationPayload(): FirmwareCalibrationStartPayload {
  return { ...DEFAULT_CALIBRATION_PAYLOAD };
}

export function startCalibration(
  deviceId: string,
  payload: FirmwareCalibrationStartPayload = DEFAULT_CALIBRATION_PAYLOAD,
): Promise<FirmwareCalibrationCommandResponse> {
  return requestJson<FirmwareCalibrationCommandResponse>(`${getFirmwareDeviceUrl(deviceId)}/calibration/start`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function cancelCalibration(deviceId: string): Promise<FirmwareCalibrationCommandResponse> {
  return requestJson<FirmwareCalibrationCommandResponse>(`${getFirmwareDeviceUrl(deviceId)}/calibration/cancel`, {
    method: "POST",
  });
}

export function getLatestCalibration(deviceId: string): Promise<FirmwareReadinessResponse> {
  return requestJson<FirmwareReadinessResponse>(`${getFirmwareDeviceUrl(deviceId)}/calibration/latest`);
}

export function getReadiness(deviceId: string): Promise<FirmwareReadinessResponse> {
  return requestJson<FirmwareReadinessResponse>(`${getFirmwareDeviceUrl(deviceId)}/readiness`);
}
