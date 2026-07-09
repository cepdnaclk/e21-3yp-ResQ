import { getHubApiBaseUrl } from "./hubApiUrl";

// This file handles the manikin registry API — the management view
// that shows all known devices with their current status.
// This is separate from browserManikinsApi.ts which handles the
// real-time live stream used by the instructor dashboard tiles.

// We reuse the same shape as the live summary since the backend
// returns the same ManikinLiveSummary record for both endpoints.
export type ManikinRegistryEntry = {
  deviceId: string;
  online: boolean;
  lastSeen: string | null;   // ISO date string from the backend
  state: string | null;
  ip: string | null;
  fw: string | null;         // firmware version
  rssi: number | null;       // WiFi signal strength in dBm
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
};

function getManikinsRegistryUrl(): string {
  return `${getHubApiBaseUrl()}/api/manikins`;
}

function normalizeManikinRegistryEntry(value: unknown): ManikinRegistryEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const deviceId = typeof record.deviceId === "string" && record.deviceId.trim() ? record.deviceId.trim() : null;

  if (!deviceId) {
    return null;
  }

  return {
    deviceId,
    online: typeof record.online === "boolean" ? record.online : false,
    lastSeen: typeof record.lastSeen === "string" && record.lastSeen.trim() ? record.lastSeen.trim() : null,
    state: typeof record.state === "string" && record.state.trim() ? record.state.trim() : null,
    ip: typeof record.ip === "string" && record.ip.trim() ? record.ip.trim() : null,
    fw: typeof record.fw === "string" && record.fw.trim() ? record.fw.trim() : null,
    rssi: typeof record.rssi === "number" && Number.isFinite(record.rssi) ? record.rssi : null,
    battery: typeof record.battery === "number" && Number.isFinite(record.battery) ? record.battery : null,
    sessionActive: typeof record.sessionActive === "boolean" ? record.sessionActive : null,
    firmwareState: typeof record.firmwareState === "string" && record.firmwareState.trim() ? record.firmwareState.trim() : null,
    calibrated: typeof record.calibrated === "boolean" ? record.calibrated : null,
    readyForSession: typeof record.readyForSession === "boolean" ? record.readyForSession : null,
    calibrationState: typeof record.calibrationState === "string" && record.calibrationState.trim() ? record.calibrationState.trim() : null,
    progressId: typeof record.progressId === "number" && Number.isFinite(record.progressId) ? record.progressId : null,
    reasonId: typeof record.reasonId === "string" && record.reasonId.trim() ? record.reasonId.trim() : null,
    actionId: typeof record.actionId === "number" && Number.isFinite(record.actionId) ? record.actionId : null,
    calibrationProgressId: typeof record.calibrationProgressId === "number" && Number.isFinite(record.calibrationProgressId) ? record.calibrationProgressId : null,
    calibrationReasonId: typeof record.calibrationReasonId === "string" && record.calibrationReasonId.trim() ? record.calibrationReasonId.trim() : null,
    calibrationActionId: typeof record.calibrationActionId === "number" && Number.isFinite(record.calibrationActionId) ? record.calibrationActionId : null,
    calibrationResult: typeof record.calibrationResult === "string" && record.calibrationResult.trim() ? record.calibrationResult.trim() : null,
    profileId: typeof record.profileId === "string" && record.profileId.trim() ? record.profileId.trim() : null,
    pressureMode: typeof record.pressureMode === "string" && record.pressureMode.trim() ? record.pressureMode.trim() : null,
    pressureDegraded: typeof record.pressureDegraded === "boolean" ? record.pressureDegraded : null,
    usingLastStablePressure: typeof record.usingLastStablePressure === "boolean" ? record.usingLastStablePressure : null,
    pressureValid: typeof record.pressureValid === "boolean" ? record.pressureValid : null,
    hallValid: typeof record.hallValid === "boolean" ? record.hallValid : null,
    depthSource: typeof record.depthSource === "string" && record.depthSource.trim() ? record.depthSource.trim() : null,
    warnings: typeof record.warnings === "string" && record.warnings.trim() ? record.warnings.trim() : null,
    lastErrorId: typeof record.lastErrorId === "string" && record.lastErrorId.trim() ? record.lastErrorId.trim() : null,
  };
}

// Fetches all known manikins from the registry.
// Unlike the live stream, this is a simple one-time fetch —
// the caller can refresh it periodically if needed.
export async function fetchManikinRegistry(): Promise<ManikinRegistryEntry[]> {
  const response = await fetch(getManikinsRegistryUrl(), {
    credentials: "include",  // sends session cookie for authentication
  });

  if (!response.ok) {
    // Extract the error message from the backend if available
    const errorData = await response.json().catch(() => null);
    throw new Error(
      errorData?.message ??
      `Failed to load manikin registry (${response.status})`
    );
  }

  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("Unexpected response format from manikin registry");
  }

  return data.map(normalizeManikinRegistryEntry).filter((entry): entry is ManikinRegistryEntry => Boolean(entry));
}
