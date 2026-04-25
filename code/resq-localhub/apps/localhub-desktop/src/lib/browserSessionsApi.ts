export type SessionStartRequest = {
  deviceId: string;
  traineeId?: string | null;
  scenario?: string | null;
  notes?: string | null;
};

export type SessionStartResponse = {
  sessionId: string;
  deviceId: string;
  traineeId: string | null;
  startedAt: string;
  active: boolean;
  scenario: string | null;
  notes: string | null;
};

export type SessionSummary = {
  sessionId: string;
  deviceId: string;
  traineeId: string | null;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  avgDepthMm: number;
  avgRateCpm: number;
  recoilPct: number;
  pausesCount: number;
  score: number;
  latestFlags: string | null;
};

export type CompletedSession = {
  sessionId: string;
  deviceId: string;
  traineeId: string | null;
  startedAt: string;
  ended: boolean;
  endedAt: string;
  scenario: string | null;
  notes: string | null;
  summary: SessionSummary;
};

export type SessionEndRequest = {
  sessionId: string;
};

export type SessionEndResponse = {
  sessionId: string;
  deviceId: string;
  traineeId: string | null;
  startedAt: string;
  ended: boolean;
  endedAt: string;
  scenario: string | null;
  notes: string | null;
  summary: SessionSummary;
};

export type SessionLiveView = {
  sessionId: string;
  deviceId: string;
  traineeId: string | null;
  active: boolean;
  startedAt: string;
  scenario: string | null;
  notes: string | null;
  lastSeen: string | null;
  state: string | null;
  online: boolean;
  ip: string | null;
  fw: string | null;
  rssi: number | null;
  battery: number | null;
  sessionActive: boolean | null;
  latestDepthMm: number | null;
  latestRateCpm: number | null;
  latestRecoilOk: boolean | null;
  latestPauseS: number | null;
  latestFlags: string | null;
  lastEventType: string | null;
  latestForce1: number | null;
  latestForce2: number | null;
  pressureBalancePct: number | null;
  pressureSkewed: boolean | null;
};

export type ApiErrorResponse = {
  error: string;
};

function getSessionsBaseUrl(): string {
  return `http://${window.location.hostname}:18080/api/sessions`;
}

function getExportBaseUrl(): string {
  return `http://${window.location.hostname}:18080/api/export/sessions`;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const data: unknown = await response.json();
  return data as T;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "Unknown error";
}

export async function startSession(request: SessionStartRequest): Promise<SessionStartResponse> {
  const response = await fetch(`${getSessionsBaseUrl()}/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorResponse = await readJsonResponse<ApiErrorResponse>(response).catch(() => null);
    throw new Error(errorResponse?.error ?? `Failed to start session (${response.status})`);
  }

  return readJsonResponse<SessionStartResponse>(response);
}

export async function endSession(request: SessionEndRequest): Promise<SessionEndResponse> {
  const response = await fetch(`${getSessionsBaseUrl()}/end`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorResponse = await readJsonResponse<ApiErrorResponse>(response).catch(() => null);
    throw new Error(errorResponse?.error ?? `Failed to end session (${response.status})`);
  }

  return readJsonResponse<SessionEndResponse>(response);
}

export async function fetchSessionLive(sessionId: string): Promise<SessionLiveView | null> {
  const response = await fetch(`${getSessionsBaseUrl()}/live/${encodeURIComponent(sessionId)}`);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const errorResponse = await readJsonResponse<ApiErrorResponse>(response).catch(() => null);
    throw new Error(errorResponse?.error ?? `Failed to load session live view (${response.status})`);
  }

  return readJsonResponse<SessionLiveView>(response);
}

export function getSessionLiveStreamUrl(sessionId: string): string {
  return `http://${window.location.hostname}:18080/api/stream/sessions/live/${encodeURIComponent(sessionId)}`;
}

export async function fetchCompletedSession(sessionId: string): Promise<CompletedSession> {
  const response = await fetch(`${getSessionsBaseUrl()}/${encodeURIComponent(sessionId)}`);

  if (!response.ok) {
    const errorResponse = await readJsonResponse<ApiErrorResponse>(response).catch(() => null);
    throw new Error(errorResponse?.error ?? `Failed to load session (${response.status})`);
  }

  return readJsonResponse<CompletedSession>(response);
}

export async function fetchCompletedSessions(): Promise<CompletedSession[]> {
  const response = await fetch(getSessionsBaseUrl());

  if (!response.ok) {
    const errorResponse = await readJsonResponse<ApiErrorResponse>(response).catch(() => null);
    throw new Error(errorResponse?.error ?? `Failed to load sessions (${response.status})`);
  }

  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("Invalid sessions response");
  }

  return data as CompletedSession[];
}

export function getSessionJsonExportUrl(sessionId: string): string {
  return `${getExportBaseUrl()}/${encodeURIComponent(sessionId)}.json`;
}

export function getSessionCsvExportUrl(sessionId: string): string {
  return `${getExportBaseUrl()}/${encodeURIComponent(sessionId)}.csv`;
}

export { getErrorMessage };
