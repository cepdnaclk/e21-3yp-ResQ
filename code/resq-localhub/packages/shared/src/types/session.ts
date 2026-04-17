export type SessionState =
  | "CREATED"
  | "ACTIVE"
  | "ENDED"
  | "INTERRUPTED"
  | "SYNC_QUEUED"
  | "SYNCED";

export interface Session {
  sessionId: string;
  mac: string;
  traineeId?: string;
  scenario?: string;
  startTime: number;
  endTime?: number;
  state: SessionState;
}

export interface SessionSummary {
  sessionId: string;
  avgRate?: number;
  depthInRangePct?: number;
  recoilPct?: number;
  pausesCount?: number;
  score?: number;
  interrupted?: boolean;
}