/**
 * userFriendlyLabels.ts — Human-readable labels for medical staff.
 *
 * Rules:
 * - All output must be safe for non-technical medical staff.
 * - No firmware codes, MQTT topics, raw IDs, or developer jargon.
 * - Coaching cues follow clinical CPR language.
 */

import type { LiveMetricPayload } from "../types/live";

// ─────────────────────────────────────────────
// Device state
// ─────────────────────────────────────────────

const DEVICE_STATE_LABELS: Record<string, string> = {
  ONLINE: "Online",
  READY_FOR_SESSION: "Ready",
  SESSION_ACTIVE: "Session running",
  CALIBRATION_FAIL: "Readiness check failed",
  CALIBRATION_CANCELLED: "Readiness check cancelled",
  ERROR: "Needs support",
  offline: "Offline",
  OFFLINE: "Offline",
  unknown: "Not seen yet",
  CONNECTING: "Connecting…",
};

const DEVICE_STATE_TONES: Record<string, "success" | "info" | "warning" | "danger" | "muted"> = {
  ONLINE: "success",
  READY_FOR_SESSION: "success",
  SESSION_ACTIVE: "info",
  CALIBRATION_FAIL: "warning",
  CALIBRATION_CANCELLED: "muted",
  ERROR: "danger",
  offline: "muted",
  OFFLINE: "muted",
  unknown: "muted",
  CONNECTING: "muted",
};

/** Returns a human-readable label for a manikin device state string. */
export function getDeviceStateLabel(state?: string | null): string {
  if (!state) return "Not seen yet";
  return DEVICE_STATE_LABELS[state] ?? state;
}

/** Returns a colour tone for a manikin device state. */
export function getDeviceStateTone(
  state?: string | null,
): "success" | "info" | "warning" | "danger" | "muted" {
  if (!state) return "muted";
  return DEVICE_STATE_TONES[state] ?? "muted";
}

// ─────────────────────────────────────────────
// Connection state
// ─────────────────────────────────────────────

const CONNECTION_STATE_LABELS: Record<string, string> = {
  CONNECTING: "Connecting…",
  MQTT_WS_LIVE: "Live",
  BACKEND_SSE_FALLBACK: "Live",
  BACKEND_POLLING_DEGRADED: "Reduced connection",
  STALE: "Signal lost",
  OFFLINE: "Offline",
  ERROR: "Connection error",
};

/** Returns a human-readable label for a connection state. */
export function getConnectionStateLabel(connectionState?: string | null): string {
  if (!connectionState) return "Connecting…";
  return CONNECTION_STATE_LABELS[connectionState] ?? "Connecting…";
}

/** Returns true if the connection is considered "live" for display purposes. */
export function isConnectionLive(connectionState?: string | null): boolean {
  return (
    connectionState === "MQTT_WS_LIVE" ||
    connectionState === "BACKEND_SSE_FALLBACK"
  );
}

// ─────────────────────────────────────────────
// Compression flags
// ─────────────────────────────────────────────

const FLAG_MESSAGES: Record<string, string> = {
  DEPTH_OK: "Good depth",
  DEPTH_LOW: "Press deeper",
  DEPTH_HIGH: "Press lighter",
  RATE_OK: "Good rhythm",
  RATE_SLOW: "Speed up slightly",
  RATE_FAST: "Slow down slightly",
  RECOIL_OK: "Good recoil",
  RECOIL_INCOMPLETE: "Release fully",
  INCOMPLETE_RECOIL: "Release fully",
  PAUSE_DETECTED: "Keep going — avoid pauses",
  HAND_PLACEMENT_WARNING: "Check hand position",
  HAND_CENTERED: "Hands centered",
};

/**
 * Parse a raw flags string (e.g. "DEPTH_OK,RATE_SLOW,RECOIL_OK") into
 * an array of human-readable messages.
 */
export function getFlagMessages(flags?: string | string[] | null): string[] {
  if (!flags) return [];
  const raw = Array.isArray(flags) ? flags : flags.split(",");
  return raw
    .map((f) => f.trim().toUpperCase())
    .map((f) => FLAG_MESSAGES[f])
    .filter((msg): msg is string => Boolean(msg));
}

// ─────────────────────────────────────────────
// Coaching cue (single primary message)
// ─────────────────────────────────────────────

/**
 * Priority order:
 * 1. Offline / stale / session ended
 * 2. Pause detected
 * 3. Depth problem
 * 4. Rate problem
 * 5. Recoil problem
 * 6. Hand placement
 * 7. Perfect compressions
 */
export function getCompressionCue(
  metric?: LiveMetricPayload | null,
  latestFlags?: string | string[] | null,
  connectionState?: string | null,
  sessionActive?: boolean | null,
): string {
  // Priority 1 — offline or no signal
  if (
    connectionState === "OFFLINE" ||
    connectionState === "STALE" ||
    connectionState === "ERROR"
  ) {
    return "Waiting for signal…";
  }

  if (sessionActive === false) {
    return "Session ended";
  }

  if (!metric) {
    return "Waiting for compressions…";
  }

  const flags = normalizeFlagsSet(latestFlags ?? metric.flags);

  // Priority 2 — pause
  if (flags.has("PAUSE_DETECTED")) {
    return "Keep going — avoid pauses";
  }

  // Priority 3 — depth
  if (flags.has("DEPTH_LOW")) return "Press deeper";
  if (flags.has("DEPTH_HIGH")) return "Press lighter";

  // Priority 4 — rate
  if (flags.has("RATE_SLOW")) return "Speed up slightly";
  if (flags.has("RATE_FAST")) return "Slow down slightly";

  // Priority 5 — recoil
  if (flags.has("RECOIL_INCOMPLETE") || flags.has("INCOMPLETE_RECOIL")) {
    return "Release fully between compressions";
  }

  // Priority 6 — hand placement
  if (flags.has("HAND_PLACEMENT_WARNING")) return "Check hand position";

  // Priority 7 — all good
  if (flags.has("DEPTH_OK") || flags.has("RATE_OK") || flags.has("RECOIL_OK")) {
    return "Good compressions — keep it up!";
  }

  return "Waiting for compressions…";
}

function normalizeFlagsSet(flags: string | string[] | null | undefined): Set<string> {
  if (!flags) return new Set();
  const raw = Array.isArray(flags) ? flags : flags.split(",");
  return new Set(raw.map((f) => f.trim().toUpperCase()));
}

// ─────────────────────────────────────────────
// Device readiness helpers
// ─────────────────────────────────────────────

/** Returns true if the device is ready to start a session. */
export function isDeviceReady(
  state?: string | null,
  online?: boolean,
  stale?: boolean,
  offline?: boolean,
): boolean {
  if (offline || stale || !online) return false;
  return state === "READY_FOR_SESSION";
}

/** Returns true if the device currently has an active session. */
export function isSessionActive(
  state?: string | null,
  active?: boolean | null,
): boolean {
  return active === true || state === "SESSION_ACTIVE";
}

// ─────────────────────────────────────────────
// Score display helpers
// ─────────────────────────────────────────────

export type ScoreTone = "excellent" | "good" | "fair" | "poor";

/** Return a qualitative label for a session score (0–100). */
export function getScoreLabel(score?: number | null): string {
  if (score === null || score === undefined) return "—";
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 50) return "Fair";
  return "Needs improvement";
}

export function getScoreTone(score?: number | null): ScoreTone {
  if (score === null || score === undefined) return "poor";
  if (score >= 85) return "excellent";
  if (score >= 70) return "good";
  if (score >= 50) return "fair";
  return "poor";
}

// ─────────────────────────────────────────────
// Duration / time display helpers
// ─────────────────────────────────────────────

/** Format duration in seconds as "MM:SS". */
export function formatDuration(seconds?: number | null): string {
  if (seconds === null || seconds === undefined) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Format a date string as a friendly local date+time. */
export function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

/** Format a date string as a short local date only. */
export function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
  } catch {
    return iso;
  }
}

// ─────────────────────────────────────────────
// Depth / rate display helpers
// ─────────────────────────────────────────────

/** Format depth in mm to a friendly string. Target is ~50mm. */
export function formatDepth(depthMm?: number | null): string {
  if (depthMm === null || depthMm === undefined) return "—";
  return `${depthMm.toFixed(1)} mm`;
}

/** Format compression rate as CPM. Target is ~110 cpm. */
export function formatRate(rateCpm?: number | null): string {
  if (rateCpm === null || rateCpm === undefined) return "—";
  return `${Math.round(rateCpm)} / min`;
}

/** Format recoil percentage. */
export function formatRecoilPct(recoilPct?: number | null): string {
  if (recoilPct === null || recoilPct === undefined) return "—";
  return `${Math.round(recoilPct)}%`;
}
