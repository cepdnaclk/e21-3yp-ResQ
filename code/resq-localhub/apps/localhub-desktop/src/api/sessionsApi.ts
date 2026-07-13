/**
 * sessionsApi.ts — V2 session API.
 */

import { getJson, postJson } from "./localHubClient";
import type {
  SessionStartRequest,
  SessionStartResponse,
  SessionEndRequest,
  SessionStopResponse,
  CompletedSession,
  SyncQueueItem,
} from "../types/session";
import type { SessionLiveView } from "../types/live";

/** POST /api/sessions/start */
export async function startSession(request: SessionStartRequest): Promise<SessionStartResponse> {
  return postJson<SessionStartResponse>("/api/sessions/start", request);
}

/** POST /api/sessions/end */
export async function endSession(request: SessionEndRequest): Promise<SessionStopResponse> {
  return postJson<SessionStopResponse>("/api/sessions/end", request);
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

/**
 * GET /api/sessions/my-active
 * Returns active session for logged-in trainee, or null if 404.
 */
export async function fetchMyActiveSession(): Promise<SessionLiveView | null> {
  try {
    return await getJson<SessionLiveView>("/api/sessions/my-active");
  } catch (err) {
    if (err instanceof Error && (err as Error & { status?: number }).status === 404) {
      return null;
    }
    throw err;
  }
}

/** GET /api/sessions/my-history */
export async function fetchMySessionHistory(): Promise<CompletedSession[]> {
  return getJson<CompletedSession[]>("/api/sessions/my-history");
}

/**
 * GET /api/sync-queue
 * Returns list of recent sync queue items.
 */
export async function fetchSyncQueue(): Promise<SyncQueueItem[]> {
  return getJson<SyncQueueItem[]>("/api/sync-queue");
}

