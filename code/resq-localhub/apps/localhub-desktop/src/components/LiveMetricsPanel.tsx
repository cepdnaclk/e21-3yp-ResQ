import type { LiveConnectionState, LiveMetricPayload, LiveSourceMode } from "@resq/shared";
import type { LiveClientState } from "../lib/liveClient";

type LiveMetricsPanelProps = {
  state: LiveClientState;
  title?: string;
  compact?: boolean;
  traineeFriendly?: boolean;
};

const COACHING_CUES: Record<string, string> = {
  DEPTH_LOW: "Push deeper",
  DEPTH_HIGH: "Too deep",
  RATE_SLOW: "Faster compressions",
  RATE_FAST: "Slow down",
  RECOIL_INCOMPLETE: "Release fully",
  PAUSE_DETECTED: "Continue compressions",
  HAND_PLACEMENT_WARNING: "Check hand placement",
};

export function LiveMetricsPanel({
  state,
  title = "Live Metrics",
  compact = false,
  traineeFriendly = false,
}: LiveMetricsPanelProps) {
  const flags = normalizeFlags(state.latestMetric?.flags);
  const cues = flags.map((flag) => COACHING_CUES[flag]).filter((cue): cue is string => Boolean(cue));
  const primaryCue = cues[0] ?? (state.latestMetric ? "Keep going" : "Waiting for live data");
  const unavailable = state.offline || state.connectionState === "OFFLINE";
  const muted = unavailable || state.stale || state.connectionState === "STALE";

  return (
    <div style={{ display: "grid", gap: "10px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: compact ? "0.95rem" : "1rem", fontWeight: 700, color: "#0f172a" }}>
          {title}
        </h3>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <ConnectionBadge state={state.connectionState} />
          <SourceBadge mode={state.sourceMode} />
        </div>
      </div>

      <LiveModeMessage state={state} />

      {!state.latestMetric ? (
        <p
          role="status"
          style={{ margin: 0, padding: "10px", borderRadius: "8px", background: "#f8fafc", color: "#475569", fontSize: "0.88rem" }}
        >
          Waiting for CPR telemetry...
        </p>
      ) : null}

      {traineeFriendly ? (
        <div style={{ padding: "12px", borderRadius: "8px", border: "1px solid #dbeafe", background: "#eff6ff" }}>
          <p style={{ margin: 0, color: "#1d4ed8", fontSize: "1rem", fontWeight: 800 }}>{primaryCue}</p>
          <p style={{ margin: "4px 0 0 0", color: "#475569", fontSize: "0.84rem" }}>
            {unavailable ? "Live connection is offline." : muted ? "Values may be delayed." : "Live feedback is updating."}
          </p>
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: compact ? "repeat(auto-fit, minmax(120px, 1fr))" : "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "8px",
          opacity: unavailable ? 0.62 : 1,
        }}
      >
        <MetricCard label="Depth" value={formatDepth(state.latestMetric, unavailable)} muted={muted} />
        <MetricCard label="Depth OK" value={formatStatus(state.latestMetric?.depthOk, unavailable)} muted={muted} />
        <MetricCard label="Rate" value={formatNumber(state.latestMetric?.rateCpm, "cpm", unavailable)} muted={muted} />
        <MetricCard label="Recoil" value={formatRecoil(state.latestMetric, unavailable)} muted={muted} />
        <MetricCard label="Pause" value={formatNumber(state.latestMetric?.pauseS, "s", unavailable)} muted={muted} />
        <MetricCard label="Compressions" value={formatCount(state.latestMetric?.compressionCount, unavailable)} muted={muted} />
        <MetricCard label="Valid Compressions" value={formatCount(state.latestMetric?.validCompressionCount, unavailable)} muted={muted} />
        <MetricCard label="Recoil OK Count" value={formatCount(state.latestMetric?.recoilOkCount, unavailable)} muted={muted} />
        <MetricCard label="Incomplete Recoil" value={formatCount(state.latestMetric?.incompleteRecoilCount, unavailable)} muted={muted} />
        <MetricCard label="Hand Placement" value={unavailable ? "Offline" : state.latestMetric?.handPlacement ?? "-"} muted={muted} />
        <MetricCard label="Pressure Balance" value={formatPercentage(state.latestMetric?.pressureBalancePct, unavailable)} muted={muted} />
      </div>

      <div style={{ display: "grid", gap: "6px" }}>
        <p style={{ margin: 0, color: "#475569", fontSize: "0.84rem" }}>
          Firmware: {state.firmwareState ?? state.latestMetric?.firmwareState ?? "-"}
        </p>
        <p style={{ margin: 0, color: "#475569", fontSize: "0.84rem" }}>
          Flags: {flags.length > 0 ? flags.join(", ") : "-"}
        </p>
        {cues.length > 0 ? (
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {cues.map((cue) => (
              <span key={cue} style={cueStyle}>
                {cue}
              </span>
            ))}
          </div>
        ) : null}
        {state.lastSeenAt ? (
          <p style={{ margin: 0, color: "#64748b", fontSize: "0.78rem" }}>
            Last live update: {formatTimestamp(state.lastSeenAt)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function connectionLabel(state: LiveConnectionState): string {
  switch (state) {
    case "MQTT_WS_LIVE":
      return "Direct MQTT";
    case "BACKEND_SSE_FALLBACK":
      return "Backend fallback";
    case "BACKEND_POLLING_DEGRADED":
      return "Polling degraded";
    case "STALE":
      return "Stale";
    case "OFFLINE":
      return "Offline";
    case "ERROR":
      return "Error";
    default:
      return "Connecting";
  }
}

function sourceLabel(mode: LiveSourceMode): string {
  switch (mode) {
    case "DIRECT_MQTT":
      return "Direct MQTT";
    case "BACKEND_SSE":
      return "Backend SSE";
    case "BACKEND_POLLING":
      return "Backend polling";
    default:
      return "No source";
  }
}

function ConnectionBadge({ state }: { state: LiveConnectionState }) {
  const palette = state === "MQTT_WS_LIVE"
    ? { background: "#dcfce7", color: "#166534" }
    : state === "BACKEND_SSE_FALLBACK" || state === "BACKEND_POLLING_DEGRADED" || state === "STALE"
      ? { background: "#fef3c7", color: "#92400e" }
      : state === "OFFLINE" || state === "ERROR"
        ? { background: "#fee2e2", color: "#991b1b" }
        : { background: "#e2e8f0", color: "#334155" };

  return <span style={{ ...badgeStyle, ...palette }}>{connectionLabel(state)}</span>;
}

function SourceBadge({ mode }: { mode: LiveSourceMode }) {
  return <span style={{ ...badgeStyle, background: "#e2e8f0", color: "#334155" }}>{sourceLabel(mode)}</span>;
}

function LiveModeMessage({ state }: { state: LiveClientState }) {
  if (state.connectionState === "BACKEND_SSE_FALLBACK" || state.sourceMode === "BACKEND_SSE") {
    return <Notice text="Using backend fallback stream. Session recording continues." tone="warn" />;
  }

  if (state.connectionState === "BACKEND_POLLING_DEGRADED" || state.sourceMode === "BACKEND_POLLING") {
    return <Notice text="Live display is degraded. Data may update slower." tone="warn" />;
  }

  if (state.connectionState === "STALE" || state.stale) {
    return <Notice text="Live data is stale. Values may be delayed." tone="warn" />;
  }

  if (state.connectionState === "OFFLINE" || state.offline) {
    return <Notice text="Device appears offline. Old values are not fresh live data." tone="error" />;
  }

  if (state.connectionState === "ERROR" || state.error) {
    return <Notice text={state.error ?? "Live display is unavailable."} tone="error" />;
  }

  return null;
}

function Notice({ text, tone }: { text: string; tone: "warn" | "error" }) {
  return (
    <p
      style={{
        margin: 0,
        padding: "8px 10px",
        borderRadius: "8px",
        border: `1px solid ${tone === "warn" ? "#fde68a" : "#fecaca"}`,
        background: tone === "warn" ? "#fffbeb" : "#fef2f2",
        color: tone === "warn" ? "#92400e" : "#991b1b",
        fontSize: "0.84rem",
        fontWeight: 600,
      }}
    >
      {text}
    </p>
  );
}

function MetricCard({ label, value, muted }: { label: string; value: string; muted: boolean }) {
  const key = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div
      className={`metric-card metric-card--${key}`}
      style={{
        padding: "14px",
        borderRadius: "12px",
        border: "1px solid #e8eef6",
        background: muted ? "#fbfbfd" : "#ffffff",
        boxShadow: muted ? "none" : "0 6px 18px rgba(15,23,42,0.06)",
      }}
      role="group"
      aria-label={label}
    >
      <p className="metric-card__label" style={{ margin: 0 }}>{label}</p>
      <p className="metric-card__value" style={{ margin: "6px 0 0 0", color: muted ? "#64748b" : "#0f172a" }}>{value}</p>
    </div>
  );
}

function normalizeFlags(value: LiveMetricPayload["flags"] | undefined): string[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter((flag): flag is string => typeof flag === "string");
      }
    } catch {
      return [trimmed];
    }
  }
  return trimmed.split(",").map((flag) => flag.trim()).filter(Boolean);
}

function formatNumber(value: number | null | undefined, suffix: string, unavailable: boolean): string {
  if (unavailable) {
    return "Offline";
  }
  return value === null || value === undefined ? "-" : `${value.toFixed(1)} ${suffix}`;
}

function formatDepth(metric: LiveMetricPayload | null | undefined, unavailable: boolean): string {
  if (unavailable) {
    return "Offline";
  }
  if (!metric) {
    return "-";
  }
  if (metric.depthMm !== null && metric.depthMm !== undefined) {
    return `${metric.depthMm.toFixed(1)} mm`;
  }
  if (metric.depthProgress !== null && metric.depthProgress !== undefined) {
    return `${Math.round(metric.depthProgress * 100)}%`;
  }
  return "-";
}

function formatCount(value: number | null | undefined, unavailable: boolean): string {
  if (unavailable) {
    return "Offline";
  }
  return value === null || value === undefined ? "-" : String(value);
}

function formatPercentage(value: number | null | undefined, unavailable: boolean): string {
  if (unavailable) {
    return "Offline";
  }
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`;
}

function formatRecoil(metric: LiveMetricPayload | null | undefined, unavailable: boolean): string {
  if (unavailable) {
    return "Offline";
  }
  if (!metric || metric.recoilOk === null) {
    return "-";
  }
  return metric.recoilOk ? "OK" : "Release fully";
}

function formatStatus(value: boolean | null | undefined, unavailable: boolean): string {
  if (unavailable) {
    return "Offline";
  }
  if (value === null || value === undefined) {
    return "-";
  }
  return value ? "OK" : "Needs improvement";
}

function formatTimestamp(value: string | number): string {
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleTimeString();
}

const badgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 9px",
  borderRadius: "999px",
  fontSize: "0.74rem",
  fontWeight: 800,
};

const cueStyle: React.CSSProperties = {
  padding: "4px 8px",
  borderRadius: "999px",
  fontSize: "0.78rem",
  fontWeight: 700,
  background: "#fee2e2",
  color: "#991b1b",
};
