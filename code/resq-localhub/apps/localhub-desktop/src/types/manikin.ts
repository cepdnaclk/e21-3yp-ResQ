/**
 * manikin.ts — Manikin device types for V2.
 *
 * Fields marked @diagnostic should NOT be displayed on normal instructor/trainee screens.
 * They are only for the TechnicianDiagnosticsPage.
 */

export type ManikinLiveSummary = {
  deviceId: string;
  sessionId: string | null;
  manikinId: string | null;
  online: boolean;
  lastSeen: string | null;

  /** Firmware device state. Use getDeviceStateLabel() to get user-friendly text. */
  state: string | null;

  /** @diagnostic — IP address: show only in diagnostics */
  ip: string | null;
  /** @diagnostic — Firmware version string */
  fw: string | null;
  /** @diagnostic — Wi-Fi signal strength (dBm) */
  rssi: number | null;
  /** @diagnostic — Battery percentage */
  battery: number | null;

  sessionActive: boolean | null;

  /** Latest compression depth in millimetres */
  latestDepthMm: number | null;
  latestDepthProgress: number | null;
  latestCompressionCount: number | null;
  /** Latest compression rate (compressions per minute) */
  latestRateCpm: number | null;
  latestRecoilOk: boolean | null;
  latestPauseS: number | null;
  /** Raw firmware flags string. Use getFlagMessages() to display. */
  latestFlags: string | null;
  lastEventType: string | null;

  /** @diagnostic — Raw force sensor readings */
  latestForce1: number | null;
  /** @diagnostic — Raw force sensor readings */
  latestForce2: number | null;

  pressureBalancePct: number | null;
  pressureSkewed: boolean | null;

  /** Session context fields (null when no active session) */
  activeSessionId: string | null;
  activeTraineeId: string | null;
  activeSessionStartedAt: string | null;
  activeSessionScenario: string | null;

  latestMetric: import("./live").LiveMetricPayload | null;
  seq: number | null;

  /** Connection state. Use getConnectionStateLabel() to display. */
  connectionState: string | null;
  stale: boolean;
  offline: boolean;
};

export type ManikinInventoryStatus =
  | "paired"
  | "pending"
  | "online"
  | "offline"
  | "stale"
  | "unknown";

export type ManikinInventoryEntry = ManikinLiveSummary & {
  status: ManikinInventoryStatus;
  rawStatus: string | null;
};

export type ManikinPairTokenResponse = {
  deviceId: string;
  token: string;
  expiresAt: string;
};
