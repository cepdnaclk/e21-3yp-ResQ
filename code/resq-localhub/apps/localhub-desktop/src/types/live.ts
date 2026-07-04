/**
 * live.ts — Live session types for V2.
 * Re-exports shared types and adds SessionLiveView.
 */
export type {
  LiveMetricPayload,
  LiveConnectionState,
  LiveFallbackSnapshot,
  LiveSourceMode,
} from "@resq/shared";

/**
 * REST snapshot of an active session's live state.
 * Returned by GET /api/sessions/live/{sessionId}
 * Also delivered via SSE session-live events.
 *
 * Fields marked @diagnostic should NOT be shown on normal screens.
 */
export type SessionLiveView = {
  sessionId: string;
  deviceId: string;
  manikinId: string | null;
  traineeId: string | null;
  active: boolean;
  startedAt: string | null;
  scenario: string | null;
  notes: string | null;
  lastSeen: string | null;
  state: string | null;
  online: boolean;

  /** @diagnostic */
  ip: string | null;
  /** @diagnostic — firmware version */
  fw: string | null;
  /** @diagnostic */
  rssi: number | null;
  /** @diagnostic */
  battery: number | null;

  sessionActive: boolean | null;
  latestDepthMm: number | null;
  latestRateCpm: number | null;
  latestRecoilOk: boolean | null;
  latestPauseS: number | null;
  latestFlags: string | null;
  lastEventType: string | null;

  /** @diagnostic */
  latestForce1: number | null;
  /** @diagnostic */
  latestForce2: number | null;

  pressureBalancePct: number | null;
  pressureSkewed: boolean | null;
  latestMetric: import("@resq/shared").LiveMetricPayload | null;
  seq: number | null;
  connectionState: string | null;
  stale: boolean;
  offline: boolean;
};
