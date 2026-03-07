import type { EventPayload, TelemetryLivePayload } from './telemetry';

export interface Session {
  id: string;
  startedAt: Date;
  endedAt?: Date;
  manikinIds: string[];
  instructorId: string;
  traineeIds: string[];
}

export interface SessionSummary {
  sessionId: string;
  events: EventPayload[];
  telemetry: TelemetryLivePayload[];
}