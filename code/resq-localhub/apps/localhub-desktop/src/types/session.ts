/**
 * session.ts — Session types for V2.
 */

export type SessionStartRequest = {
  deviceId: string;
  courseId: string;
  traineeId: string;
  profileId: string;
  scenario?: string | null;
  notes?: string | null;
};

export type SessionRecoveryStatus =
  | "NONE"
  | "PENDING"
  | "CONFIRMED"
  | "CONFLICT"
  | "TIMED_OUT"
  | "FAILED";

export type SessionStartResponse = {
  sessionId: string;
  deviceId: string;
  traineeId: string | null;
  courseId?: string | null;
  instructorId?: string | null;
  startedAt: string;
  active: boolean;
  profileId?: string | null;
  scenario: string | null;
  notes: string | null;
  state?: string | null;
  lifecycleState?: string | null;
  requestId?: string | null;
  recoveryStatus?: SessionRecoveryStatus | null;
};

export type SessionEndRequest = {
  sessionId: string;
};

export type SessionLifecycleState =
  | "START_PENDING"
  | "START_REJECTED"
  | "START_TIMEOUT"
  | "ACTIVE"
  | "STOP_PENDING"
  | "COMPLETED"
  | "STOP_REJECTED"
  | "STOP_TIMEOUT"
  | "INTERRUPTED";

export type SessionStopResponse = {
  sessionId: string;
  deviceId: string;
  requestId: string | null;
  state: SessionLifecycleState;
  active: boolean;
  completed: boolean;
  startedAt: string | null;
  stopRequestedAt: string | null;
  reason: string | null;
  reasonId: string | null;
  actionId: number | null;
  recoveryStatus?: SessionRecoveryStatus | null;
};

export type SessionSummary = {
  sessionId: string;
  deviceId: string;
  traineeId: string | null;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  sampleCount: number;
  totalCompressions: number;
  validCompressions: number;
  avgDepthMm: number | null;
  avgDepthProgress: number | null;
  avgRateCpm: number | null;
  recoilPct: number | null;
  recoilOkCount: number;
  incompleteRecoilCount: number;
  pausesCount: number;
  score: number;
  latestFlags: string | null;
  scoringVersion?: string | null;
  overallScore?: number | null;
  grade?: string | null;
  depthScore?: number | null;
  rateScore?: number | null;
  recoilScore?: number | null;
  handPlacementScore?: number | null;
  compressionFractionScore?: number | null;
  scoreCap?: number | null;
  scoreCapReason?: string | null;
  scoreProvisional?: boolean;
  scoreValidCompressionCount?: number;
  handPlacementPct?: number | null;
  compressionFractionPct?: number | null;
  recommendation?: string | null;
  depthTarget?: string | null;
  rateTarget?: string | null;
  recoilTarget?: string | null;
  handPlacementTarget?: string | null;
  compressionFractionTarget?: string | null;
};

export type SessionEndResponse = {
  sessionId: string;
  deviceId: string;
  traineeId: string | null;
  courseId?: string | null;
  instructorId?: string | null;
  startedAt: string;
  ended: boolean;
  endedAt: string;
  scenario: string | null;
  notes: string | null;
  summary: SessionSummary;
};

/** A completed session as returned by GET /api/sessions and GET /api/sessions/{id}. */
export type CompletedSession = SessionEndResponse;

export interface SyncQueueItem {
  id: string;
  entityType: 'SESSION_SUMMARY';
  entityId: string;
  payloadJson: string;
  syncStatus: 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'RETRY_LATER' | 'SKIPPED';
  retryCount: number;
  lastError: string | null;
  createdAt: string;
  lastAttemptAt: string | null;
  syncedAt: string | null;
}

