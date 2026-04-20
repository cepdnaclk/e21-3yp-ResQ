export interface TelemetryLivePayload {
  manikinId: string;
  timestamp: Date;
  values: Record<string, number>;
}
export interface EventPayload {
  manikinId: string;
  eventType: string;
  timestamp: Date;
  details?: Record<string, any>;
}// telemetry data types
// TODO: define metrics, timestamps, source
