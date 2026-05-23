import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { type ManikinLiveSummary } from "../lib/browserManikinsApi";
import {
  getFirmwareDiagnostics,
  requestFirmwareDebugSnapshot,
  type FirmwareDeviceDiagnosticsResponse,
  type FirmwareReadinessResponse,
} from "../lib/browserFirmwareApi";

type FirmwareDiagnosticsPanelProps = {
  deviceId: string;
  readiness?: FirmwareReadinessResponse | null;
  liveSummary?: ManikinLiveSummary | null;
};

export function FirmwareDiagnosticsPanel({ deviceId, readiness, liveSummary }: FirmwareDiagnosticsPanelProps) {
  const [diagnostics, setDiagnostics] = useState<FirmwareDeviceDiagnosticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [debugRequestState, setDebugRequestState] = useState<"idle" | "sending">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const response = await getFirmwareDiagnostics(deviceId);
        if (!cancelled) {
          setDiagnostics(response);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setDiagnostics(null);
          setError(loadError instanceof Error ? loadError.message : "Failed to load firmware diagnostics.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  async function refresh() {
    setRefreshing(true);
    try {
      const response = await getFirmwareDiagnostics(deviceId);
      setDiagnostics(response);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load firmware diagnostics.");
    } finally {
      setRefreshing(false);
    }
  }

  async function requestDebugSnapshot() {
    setDebugRequestState("sending");
    try {
      await requestFirmwareDebugSnapshot(deviceId);
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to request a debug snapshot.");
    } finally {
      setDebugRequestState("idle");
    }
  }

  const currentReadiness = readiness ?? diagnostics?.readiness ?? null;
  const latestCalibration = diagnostics?.latestCalibration ?? null;
  const recentCommands = diagnostics?.recentCommands ?? [];
  const recentEvents = diagnostics?.recentEvents ?? [];
  const recentDebugSnapshots = diagnostics?.recentDebugSnapshots ?? [];
  const latestDebugSnapshot = recentDebugSnapshots[0] ?? null;
  const latestLiveSummary = liveSummary ?? diagnostics?.liveSummary ?? null;

  return (
    <details style={{ border: "1px solid #e2e8f0", borderRadius: "8px", background: "#f8fafc", padding: "10px" }}>
      <summary style={{ cursor: "pointer", fontWeight: 700, color: "#334155" }}>Firmware Diagnostics</summary>
      <div style={{ display: "grid", gap: "10px", marginTop: "10px" }}>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing || loading}
            style={buttonStyle(refreshing || loading)}
          >
            {refreshing || loading ? "Refreshing..." : "Refresh diagnostics"}
          </button>
          <button
            type="button"
            onClick={requestDebugSnapshot}
            disabled={debugRequestState === "sending"}
            style={buttonStyle(debugRequestState === "sending")}
          >
            {debugRequestState === "sending" ? "Requesting debug..." : "Request Debug Snapshot"}
          </button>
        </div>

        {error ? (
          <p style={{ margin: 0, color: "#b91c1c", fontSize: "0.84rem" }}>{error}</p>
        ) : null}

        <div style={gridStyle}>
          <InfoRow label="Readiness" value={currentReadiness ? `${currentReadiness.firmwareState ?? "-"} / ${currentReadiness.readyForSession ? "Ready" : "Not Ready"}` : "-"} />
          <InfoRow label="Calibration" value={latestCalibration ? `${latestCalibration.result ?? "-"} (${latestCalibration.status ?? "-"})` : "-"} />
          <InfoRow label="Live State" value={latestLiveSummary ? `${latestLiveSummary.state ?? "-"} / ${latestLiveSummary.online ? "Online" : "Offline"}` : "-"} />
          <InfoRow label="Commands" value={String(recentCommands.length)} />
          <InfoRow label="Events" value={String(recentEvents.length)} />
          <InfoRow label="Debug Snapshots" value={String(recentDebugSnapshots.length)} />
        </div>

        <Section title="Recent Commands">
          {recentCommands.length === 0 ? <EmptyText text="No recent command requests." /> : recentCommands.slice(0, 3).map((command) => <CommandRow key={command.requestId} command={command} />)}
        </Section>

        <Section title="Recent Events">
          {recentEvents.length === 0 ? <EmptyText text="No recent firmware events." /> : recentEvents.slice(0, 3).map((event) => <EventRow key={event.id} event={event} />)}
        </Section>

        <Section title="Latest Debug Snapshot">
          {latestDebugSnapshot ? <DebugRow snapshot={latestDebugSnapshot} /> : <EmptyText text="No debug snapshots recorded yet." />}
        </Section>
      </div>
    </details>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: "8px", borderRadius: "8px", border: "1px solid #e2e8f0", background: "#ffffff" }}>
      <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>{label}</div>
      <div style={{ marginTop: "4px", fontSize: "0.84rem", color: "#0f172a", fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: "grid", gap: "6px" }}>
      <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#334155" }}>{title}</div>
      <div style={{ display: "grid", gap: "6px" }}>{children}</div>
    </div>
  );
}

function CommandRow({ command }: { command: FirmwareDeviceDiagnosticsResponse["recentCommands"][number] }) {
  return (
    <div style={entryStyle}>
      <div style={entryTitleStyle}>{command.commandName}</div>
      <div style={entryMetaStyle}>request_id: {command.requestId}</div>
      <div style={entryMetaStyle}>status: {command.status} | reply_status: {command.replyStatus ?? "-"}</div>
      <div style={entryMetaStyle}>reason_id: {command.reasonId ?? "-"} | action_id: {command.actionId ?? "-"}</div>
    </div>
  );
}

function EventRow({ event }: { event: FirmwareDeviceDiagnosticsResponse["recentEvents"][number] }) {
  return (
    <div style={entryStyle}>
      <div style={entryTitleStyle}>event_id: {event.eventId ?? "-"}</div>
      <div style={entryMetaStyle}>topic_family: {event.topicFamily}</div>
      <div style={entryMetaStyle}>state: {event.firmwareState ?? "-"} | result/status: {event.result ?? event.status ?? "-"}</div>
      <div style={entryMetaStyle}>reason_id: {event.reasonId ?? "-"} | action_id: {event.actionId ?? "-"} | progress_id: {event.progressId ?? "-"}</div>
    </div>
  );
}

function DebugRow({ snapshot }: { snapshot: FirmwareDeviceDiagnosticsResponse["recentDebugSnapshots"][number] }) {
  return (
    <div style={entryStyle}>
      <div style={entryTitleStyle}>ts_ms: {snapshot.tsMs ?? "-"}</div>
      <div style={entryMetaStyle}>pressure_0_raw: {snapshot.pressure0Raw ?? "-"}</div>
      <div style={entryMetaStyle}>pressure_1_raw: {snapshot.pressure1Raw ?? "-"}</div>
      <div style={entryMetaStyle}>pressure_2_raw: {snapshot.pressure2Raw ?? "-"}</div>
      <div style={entryMetaStyle}>hall_raw: {snapshot.hallRaw ?? "-"}</div>
    </div>
  );
}

function EmptyText({ text }: { text: string }) {
  return <div style={{ fontSize: "0.82rem", color: "#64748b" }}>{text}</div>;
}

function buttonStyle(disabled: boolean): CSSProperties {
  return {
    padding: "6px 10px",
    borderRadius: "6px",
    border: "1px solid #cbd5e1",
    background: disabled ? "#e2e8f0" : "#ffffff",
    color: disabled ? "#94a3b8" : "#334155",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 700,
    fontSize: "0.82rem",
  };
}

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: "8px",
};

const entryStyle: CSSProperties = {
  padding: "8px",
  borderRadius: "8px",
  border: "1px solid #e2e8f0",
  background: "#ffffff",
};

const entryTitleStyle: CSSProperties = {
  fontSize: "0.82rem",
  fontWeight: 700,
  color: "#0f172a",
};

const entryMetaStyle: CSSProperties = {
  marginTop: "3px",
  fontSize: "0.76rem",
  color: "#475569",
};
