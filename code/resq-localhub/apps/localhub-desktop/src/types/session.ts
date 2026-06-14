/**
 * session.ts — Session types for V2.
 */

export type SessionStartRequest = {
  deviceId: string;
  courseId: string;
  traineeId: string;
  scenario?: string | null;
  notes?: string | null;
};

export type SessionStartResponse = {
  sessionId: string;
  deviceId: string;
  traineeId: string | null;
  courseId?: string | null;
  instructorId?: string | null;
  startedAt: string;
  active: boolean;
  scenario: string | null;
  notes: string | null;
};

export type SessionEndRequest = {
  sessionId: string;
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

