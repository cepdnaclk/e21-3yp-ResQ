import { getHubApiBaseUrl, getLocalServiceHost } from "./hubApiUrl";

export type ManikinLiveSummary = {
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
};

export type ManikinInventoryStatus = "paired" | "pending" | "online" | "offline" | "stale" | "unknown";

export type ManikinInventoryEntry = ManikinLiveSummary & {
  status: ManikinInventoryStatus;
  rawStatus: string | null;
};

function getLiveManikinsUrl(): string {
  return `${getHubApiBaseUrl()}/api/manikins/live`;
}

function getManikinInventoryUrl(): string {
  return `${getHubApiBaseUrl()}/api/manikins`;
}

export function getLiveManikinsStreamUrl(): string {
  return `${getHubApiBaseUrl()}/api/stream/manikins/live`;
}

export async function fetchLiveManikins(): Promise<ManikinLiveSummary[]> {
  const response = await fetch(getLiveManikinsUrl(), {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`Failed to load live manikins (${response.status})`);
  }

  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("Invalid live manikins response");
  }

  return data as ManikinLiveSummary[];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeLiveSummary(value: unknown): ManikinLiveSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const deviceId = asString(record.deviceId);

  if (!deviceId) {
    return null;
  }

  return {
    deviceId,
    online: asBoolean(record.online) ?? false,
    lastSeen: asString(record.lastSeen),
    state: asString(record.state),
    ip: asString(record.ip),
    fw: asString(record.fw),
    rssi: asNumber(record.rssi),
    battery: asNumber(record.battery),
    sessionActive: asBoolean(record.sessionActive),
    firmwareState: asString(record.firmwareState),
    calibrated: asBoolean(record.calibrated),
    readyForSession: asBoolean(record.readyForSession),
    calibrationState: asString(record.calibrationState),
    progressId: asNumber(record.progressId),
    reasonId: asString(record.reasonId),
    actionId: asNumber(record.actionId),
    calibrationProgressId: asNumber(record.calibrationProgressId),
    calibrationReasonId: asString(record.calibrationReasonId),
    calibrationActionId: asNumber(record.calibrationActionId),
    calibrationResult: asString(record.calibrationResult),
    profileId: asString(record.profileId),
    pressureMode: asString(record.pressureMode),
    pressureDegraded: asBoolean(record.pressureDegraded),
    usingLastStablePressure: asBoolean(record.usingLastStablePressure),
    pressureValid: asBoolean(record.pressureValid),
    hallValid: asBoolean(record.hallValid),
    depthSource: asString(record.depthSource),
    warnings: asString(record.warnings),
    lastErrorId: asString(record.lastErrorId),
    latestDepthMm: asNumber(record.latestDepthMm),
    latestDepthProgress: asNumber(record.latestDepthProgress),
    latestCompressionCount: asNumber(record.latestCompressionCount),
    latestRateCpm: asNumber(record.latestRateCpm),
    latestRecoilOk: asBoolean(record.latestRecoilOk),
    latestPauseS: asNumber(record.latestPauseS),
    latestFlags: asString(record.latestFlags),
    lastEventType: asString(record.lastEventType),
    latestForce1: asNumber(record.latestForce1),
    latestForce2: asNumber(record.latestForce2),
    pressureBalancePct: asNumber(record.pressureBalancePct),
    pressureSkewed: asBoolean(record.pressureSkewed),
    activeSessionId: asString(record.activeSessionId),
    activeTraineeId: asString(record.activeTraineeId),
    activeSessionStartedAt: asString(record.activeSessionStartedAt),
    activeSessionScenario: asString(record.activeSessionScenario),
  };
}

function normalizeInventoryStatus(value: unknown, summary: Pick<ManikinInventoryEntry, "online" | "state" | "lastSeen" | "activeSessionId" | "sessionActive">): ManikinInventoryStatus {
  const raw = asString(value)?.toLowerCase() ?? "";
  const state = summary.state?.toLowerCase() ?? "";

  if (raw.includes("pending") || state.includes("pending")) {
    return "pending";
  }

  if (raw.includes("paired") || state.includes("paired") || Boolean(summary.activeSessionId) || summary.sessionActive) {
    return "paired";
  }

  if (raw.includes("stale") || state.includes("stale")) {
    return "stale";
  }

  if (raw.includes("offline") || state.includes("offline") || summary.online === false) {
    return "offline";
  }

  if (raw.includes("online") || state.includes("online") || summary.online) {
    return "online";
  }

  return "unknown";
}

function normalizeInventoryEntry(value: unknown): ManikinInventoryEntry | null {
  const summary = normalizeLiveSummary(value);
  if (!summary) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const rawStatus = asString(record.status) ?? asString(record.pairingStatus) ?? asString(record.lifecycle) ?? summary.state;

  return {
    ...summary,
    status: normalizeInventoryStatus(rawStatus, summary),
    rawStatus,
  };
}

async function fetchInventoryFrom(path: string): Promise<ManikinInventoryEntry[]> {
  const response = await fetch(path, {
    credentials: "include",
  });

  if (!response.ok) {
    const error = new Error(`Failed to load manikin inventory (${response.status})`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("Invalid manikin inventory response");
  }

  return data.map(normalizeInventoryEntry).filter((entry): entry is ManikinInventoryEntry => Boolean(entry));
}

export async function fetchManikinInventory(): Promise<ManikinInventoryEntry[]> {
  try {
    return await fetchInventoryFrom(getManikinInventoryUrl());
  } catch (error) {
    const status = error instanceof Error ? (error as Error & { status?: number }).status : undefined;

    if (status === 404) {
      return fetchInventoryFrom(getLiveManikinsUrl()).then((entries) =>
        entries.map((entry) => ({
          ...entry,
          status: entry.online ? "online" : "offline",
          rawStatus: entry.state,
        }))
      );
    }

    throw error;
  }
}
