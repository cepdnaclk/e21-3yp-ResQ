/**
 * sessionsApi.ts — V2 session API.
 */

import { getJson, postJson } from "./localHubClient";
import type {
  SessionStartRequest,
  SessionStartResponse,
  SessionEndRequest,
  SessionEndResponse,
  CompletedSession,
} from "../types/session";
import type { SessionLiveView } from "../types/live";

/** POST /api/sessions/start */
export async function startSession(request: SessionStartRequest): Promise<SessionStartResponse> {
  return postJson<SessionStartResponse>("/api/sessions/start", request);
}

/** POST /api/sessions/end */
export async function endSession(request: SessionEndRequest): Promise<SessionEndResponse> {
  return postJson<SessionEndResponse>("/api/sessions/end", request);
}

/** GET /api/sessions — all completed sessions (sorted by most recent first) */
export async function fetchCompletedSessions(): Promise<CompletedSession[]> {
  return getJson<CompletedSession[]>("/api/sessions");
}

/** GET /api/sessions/{sessionId} — single completed session */
export async function fetchCompletedSession(sessionId: string): Promise<CompletedSession> {
  return getJson<CompletedSession>(`/api/sessions/${encodeURIComponent(sessionId)}`);
}

/**
 * GET /api/sessions/live/{sessionId}
 * REST snapshot of the live session state. Used as initial load before SSE connects.
 * Returns null if the session is not found (404).
 */
export async function fetchSessionLive(sessionId: string): Promise<SessionLiveView | null> {
  try {
    return await getJson<SessionLiveView>(
      `/api/sessions/live/${encodeURIComponent(sessionId)}`,
    );
  } catch (err) {
    if (err instanceof Error && (err as Error & { status?: number }).status === 404) {
      return null;
    }
    throw err;
  }
}
