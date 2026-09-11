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
  return getJson<CompletedSession>(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    completionRead: Date.now(),
  });
}

export type CompletedSessionRetryOptions = {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export function hasAuthoritativeScoreSummary(session: CompletedSession): boolean {
  const summary = session?.summary as unknown as Record<string, unknown> | undefined;
  if (!summary || typeof summary.scoringVersion !== "string") return false;
  // Historical sessions were persisted before the component-score model existed.
  // Their legacy score is already authoritative and must remain reviewable.
  if (summary.scoringVersion === "legacy-v0") {
    return typeof summary.score === "number";
  }
  if (summary.scoringVersion !== "moderate-v1") return false;
  const requiredFields = [
    "overallScore",
    "grade",
    "depthScore",
    "rateScore",
    "recoilScore",
    "handPlacementScore",
    "compressionFractionScore",
    "scoreProvisional",
  ];
  return requiredFields.every((field) => Object.prototype.hasOwnProperty.call(summary, field));
}

/**
 * Waits only for the short persistence-visibility window after authoritative
 * completion. It is deliberately bounded so a missing result becomes an
 * actionable error rather than an endless loading state.
 */
export async function fetchAuthoritativeCompletedSession(
  sessionId: string,
  options: CompletedSessionRetryOptions = {},
): Promise<CompletedSession> {
  const intervalMs = options.intervalMs ?? 250;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;

  while (!options.signal?.aborted) {
    try {
      const completed = await fetchCompletedSession(sessionId);
      if (hasAuthoritativeScoreSummary(completed)) return completed;
      lastError = new Error("Completed session summary does not yet contain the authoritative score fields.");
    } catch (error) {
      lastError = error;
    }

    if (Date.now() >= deadline) break;
    await new Promise<void>((resolve) => {
      const finish = () => {
        options.signal?.removeEventListener("abort", abort);
        resolve();
      };
      const timer = window.setTimeout(finish, intervalMs);
      const abort = () => {
        window.clearTimeout(timer);
        finish();
      };
      options.signal?.addEventListener("abort", abort, { once: true });
    });
  }

  if (options.signal?.aborted) {
    throw new DOMException("Session summary request was cancelled.", "AbortError");
  }
  const detail = lastError instanceof Error ? ` ${lastError.message}` : "";
  throw new Error(`The session ended, but its final score was not readable within ${timeoutMs / 1000} seconds.${detail}`);
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

