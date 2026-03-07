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
}// session types
// TODO: define structure for training sessions, timestamps, participants
