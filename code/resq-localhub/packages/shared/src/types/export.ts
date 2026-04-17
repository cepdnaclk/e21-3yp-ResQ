import type { Session, SessionSummary } from "./session";
import type {
  LiveTelemetryPayload,
  TelemetryEventPayload,
} from "./telemetry";

export interface SessionExportJson {
  session: Session;
  summary: SessionSummary;
  timeline?: Array<LiveTelemetryPayload | TelemetryEventPayload>;
}

export interface SessionExportCsvRow {
  sessionId: string;
  mac: string;
  traineeId?: string;
  ts: number;
  depth_mm?: number;
  rate_cpm?: number;
  recoil_ok?: boolean;
  pause_s?: number;
  eventType?: string;
}