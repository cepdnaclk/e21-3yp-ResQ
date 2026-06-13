/**
 * liveEventsClient.ts — V2 SSE subscription wrapper.
 *
 * This wraps the existing sseLiveClient.ts without replacing it.
 * The underlying EventSource, SseEmitter, and event names are untouched.
 *
 * Protected SSE endpoints:
 *   GET /api/stream/manikins/live   (event: manikins-live)
 *   GET /api/stream/sessions/live/{sessionId}  (event: session-live)
 *
 * Protected files this module depends on (do NOT modify):
 *   src/lib/sseLiveClient.ts
 *   src/lib/liveClient.ts
 */

import {
  createSseLiveClient,
  type SseLiveClient,
  type SseLiveClientCallbacks,
} from "../lib/sseLiveClient";
import { getHubApiBaseUrl } from "../lib/hubApiUrl";
import type { ManikinLiveSummary } from "../types/manikin";
import type { SessionLiveView } from "../types/live";

export type ManikinsLiveUpdate = ManikinLiveSummary[];

export type ManikinsLiveSubscription = {
  stop: () => void;
};

export type SessionLiveSubscription = {
  stop: () => void;
};

// ─────────────────────────────────────────────
// Manikins live stream
// ─────────────────────────────────────────────

/**
 * Subscribe to the instructor-wide manikins live stream.
 * Uses SSE event `manikins-live`.
 *
 * @param onUpdate  Called whenever a snapshot update arrives
 * @param onError   Called on SSE error (optional)
 * @returns Subscription with stop() method
 */
export function subscribeToManikinsLive(
  onUpdate: (manikins: ManikinsLiveUpdate) => void,
  onError?: (error: Error) => void,
): ManikinsLiveSubscription {
  // We need a deviceId placeholder for the existing sseLiveClient API.
  // For the instructor all-manikins stream, we use "*" which matches any device update.
  const backendBaseUrl = getHubApiBaseUrl();

  // sseLiveClient expects a deviceId for filtering. Since we want all devices,
  // we use a raw EventSource directly for this stream.
  const url = `${backendBaseUrl}/api/stream/manikins/live`;
  let stopped = false;
  const eventSource = new EventSource(url, { withCredentials: true });

  eventSource.addEventListener("manikins-live", (event: MessageEvent<string>) => {
    if (stopped) return;
    try {
      const parsed: unknown = JSON.parse(event.data);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      onUpdate(list as ManikinsLiveUpdate);
    } catch {
      // ignore malformed payloads
    }
  });

  eventSource.onerror = () => {
    if (!stopped) {
      onError?.(new Error("Manikins live stream connection error"));
    }
  };

  return {
    stop() {
      stopped = true;
      eventSource.close();
    },
  };
}

// ─────────────────────────────────────────────
// Session live stream
// ─────────────────────────────────────────────

/**
 * Subscribe to a per-session live stream.
 * Uses SSE event `session-live`.
 * When the session ends, the backend sends a null payload — onEnded is called.
 *
 * @param sessionId  The session UUID to subscribe to
 * @param deviceId   The manikin device ID (needed for sseLiveClient filtering)
 * @param onUpdate   Called whenever a live snapshot arrives
 * @param onEnded    Called when the session ends (backend sends null payload)
 * @param onError    Called on SSE error (optional)
 */
export function subscribeToSessionLive(
  sessionId: string,
  deviceId: string,
  onUpdate: (view: SessionLiveView) => void,
  onEnded: () => void,
  onError?: (error: Error) => void,
): SessionLiveSubscription {
  const backendBaseUrl = getHubApiBaseUrl();
  const url = `${backendBaseUrl}/api/stream/sessions/live/${encodeURIComponent(sessionId)}`;
  let stopped = false;
  const eventSource = new EventSource(url, { withCredentials: true });

  eventSource.addEventListener("session-live", (event: MessageEvent<string>) => {
    if (stopped) return;
    try {
      const parsed: unknown = JSON.parse(event.data);
      if (parsed === null || parsed === undefined) {
        onEnded();
        return;
      }
      onUpdate(parsed as SessionLiveView);
    } catch {
      // ignore malformed payloads
    }
  });

  eventSource.onerror = () => {
    if (!stopped) {
      onError?.(new Error("Session live stream connection error"));
    }
  };

  return {
    stop() {
      stopped = true;
      eventSource.close();
    },
  };
}

// Re-export the existing low-level client in case V2 pages need it directly.
export { createSseLiveClient };
export type { SseLiveClient, SseLiveClientCallbacks };
