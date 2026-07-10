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
  SyncQueueItem,
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

export interface CprCoachQueryRequest {
  userId: string;
  question: string;
  fromDate?: string;
  toDate?: string;
}

export interface CprCoachQueryResponse {
  answer: string;
  mainIssues: string[];
  recommendations: string[];
  badSessions: {
    sessionId: string;
    sessionDateTime: string;
    overallScore: number;
    failedMetrics: string[];
    shortReason: string;
    recommendation: string;
  }[];
  trendDirection: string;
}

export async function queryCoach(request: CprCoachQueryRequest): Promise<CprCoachQueryResponse> {
  return postJson<CprCoachQueryResponse>("/api/coach/query", request);
}

export interface CprInstructorCoachQueryRequest {
  question: string;
  traineeId?: string;
  sessionId?: string;
  fromDate?: string;
  toDate?: string;
}

export interface CprInstructorCoachQueryResponse {
  answer: string;
  priorityTrainees: {
    traineeId: string;
    name: string;
    lastSessionScore: number;
    reasonForAttention: string;
    lastSessionId: string;
  }[];
  commonIssues: string[];
  suggestedInstructorActions: string[];
  relatedSessionIds: string[];
}

export async function queryInstructorCoach(request: CprInstructorCoachQueryRequest): Promise<CprInstructorCoachQueryResponse> {
  return postJson<CprInstructorCoachQueryResponse>("/api/instructor/coach/query", request);
}



