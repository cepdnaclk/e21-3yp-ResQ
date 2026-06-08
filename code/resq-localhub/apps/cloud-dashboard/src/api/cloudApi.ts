export interface CloudHealth {
  status: string;
  service: string;
  version: string;
  storageMode: string;
  timestamp: string;
}

export interface CloudSessionPayload {
  contractVersion: string;
  entityType: "SESSION_SUMMARY";
  localHubId?: string | null;
  localSessionId: string;
  sessionId?: string | null;
  deviceId?: string | null;
  manikinId?: string | null;
  traineeId?: string | null;
  instructorId?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  durationMs?: number | null;
  status?: string | null;
  result?: string | null;
  totalCompressions?: number | null;
  validCompressions?: number | null;
  avgDepthMm?: number | null;
  avgRateCpm?: number | null;
  recoilOkPct?: number | null;
  recoilOkCount?: number | null;
  incompleteRecoilCount?: number | null;
  pauseCount?: number | null;
  score?: number | null;
  flags?: string | null;
  summaryNotes?: string | null;
  scenario?: string | null;
  source?: string | null;
  generatedAt?: string | null;
}

export interface CloudSessionRecord {
  cloudSessionId: string;
  idempotencyKey: string;
  payload: CloudSessionPayload;
  createdAt: string;
  updatedAt: string;
}

const configuredBaseUrl = import.meta.env.VITE_CLOUD_API_BASE_URL?.trim();
export const cloudApiBaseUrl = (configuredBaseUrl || "http://localhost:19080").replace(/\/+$/, "");

async function getJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${cloudApiBaseUrl}${path}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    const detail = error instanceof Error && error.message ? ` (${error.message})` : "";
    throw new CloudApiError(`Cloud API is unavailable. Start cloud-api and try again.${detail}`);
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new CloudApiError(
      `Cloud API request failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
      response.status,
    );
  }

  return response.json() as Promise<T>;
}

export function fetchCloudHealth(): Promise<CloudHealth> {
  return getJson("/api/cloud/health");
}

export function fetchCloudSessions(): Promise<CloudSessionRecord[]> {
  return getJson("/api/cloud/sessions");
}

export function fetchCloudSession(cloudSessionId: string): Promise<CloudSessionRecord> {
  return getJson(`/api/cloud/sessions/${encodeURIComponent(cloudSessionId)}`);
}

export class CloudApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "CloudApiError";
  }
}
