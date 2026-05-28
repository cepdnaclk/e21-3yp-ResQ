import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Dialog,
} from "./ui/dialog";
import { type CompletedSession, getSessionReviewExportUrl } from "../lib/browserSessionsApi";

type LocalSessionReviewPanelProps = {
  latestEndedSession: CompletedSession | null;
  sessions: CompletedSession[];
  loading: boolean;
  error: string | null;
  canExport: boolean;
  expandedSessionId: string | null;
  expandedSessionDetail: CompletedSession | null;
  expandedSessionLoading: boolean;
  expandedSessionError: string | null;
  onSelectSession: (sessionId: string) => void;
  onRefresh: () => void;
};

export function LocalSessionReviewPanel({
  latestEndedSession,
  sessions,
  loading,
  error,
  canExport,
  expandedSessionId,
  expandedSessionDetail,
  expandedSessionLoading,
  expandedSessionError,
  onSelectSession,
  onRefresh,
}: LocalSessionReviewPanelProps) {
  const [viewMode, setViewMode] = useState<"grid" | "heatmap">("grid");
  const [exportingFormat, setExportingFormat] = useState<"json" | "csv" | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [enteringSessionIds, setEnteringSessionIds] = useState<Set<string>>(new Set());
  const previousSessionIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const currentIds = new Set(sessions.map((session) => session.sessionId));
    const previousIds = previousSessionIdsRef.current;
    const newIds = sessions.filter((session) => !previousIds.has(session.sessionId)).map((session) => session.sessionId);

    previousSessionIdsRef.current = currentIds;

    if (newIds.length === 0) {
      return;
    }

    setEnteringSessionIds((current) => {
      const next = new Set(current);
      for (const sessionId of newIds) {
        next.add(sessionId);
      }
      return next;
    });

    const timeout = window.setTimeout(() => {
      setEnteringSessionIds((current) => {
        const next = new Set(current);
        for (const sessionId of newIds) {
          next.delete(sessionId);
        }
        return next;
      });
    }, 700);

    return () => window.clearTimeout(timeout);
  }, [sessions]);

  const selectedSession = expandedSessionDetail;
  const selectedSessionOpen = dialogOpen && Boolean(expandedSessionId && expandedSessionDetail && expandedSessionId === expandedSessionDetail.sessionId);
  const chartSeries = useMemo(() => buildCompressionSeries(expandedSessionDetail), [expandedSessionDetail]);
  const heatmap = useMemo(() => buildSessionHeatmap(sessions), [sessions]);

  function handleExport(sessionId: string, format: "json" | "csv") {
    setExportingFormat(format);
    window.setTimeout(() => {
      triggerDownload(getSessionReviewExportUrl(sessionId, format));
      setExportingFormat(null);
    }, 650);
  }

  return (
    <section style={styles.card}>
      <div style={styles.headerRow}>
        <div>
          <h2 style={styles.heading}>Local Session Review</h2>
          <p style={styles.subheading}>Review recent local and simulator sessions, then export a clean demo package.</p>
        </div>
        <div style={styles.headerActions}>
          <div style={styles.viewToggle}>
            <button type="button" onClick={() => setViewMode("grid")} style={viewMode === "grid" ? styles.viewToggleActive : styles.viewToggleButton}>
              Grid
            </button>
            <button type="button" onClick={() => setViewMode("heatmap")} style={viewMode === "heatmap" ? styles.viewToggleActive : styles.viewToggleButton}>
              Heatmap
            </button>
          </div>
          <button type="button" onClick={onRefresh} disabled={loading} style={styles.refreshButton}>
            Refresh
          </button>
        </div>
      </div>

      {latestEndedSession ? (
        <div style={styles.summaryBanner}>
          <div style={styles.bannerLabel}>Latest completed session</div>
          <div style={styles.bannerTitle}>
            {latestEndedSession.deviceId} • {latestEndedSession.sessionId}
          </div>
          <div style={styles.bannerMeta}>
            Trainee {latestEndedSession.traineeId ?? "-"} • {formatDateTime(latestEndedSession.endedAt)} • Score {latestEndedSession.summary.score}
          </div>
          <div style={styles.metricRow}>
            <Metric label="Samples" value={String(latestEndedSession.summary.sampleCount)} />
            <Metric label="Compressions" value={`${latestEndedSession.summary.validCompressions}/${latestEndedSession.summary.totalCompressions}`} />
            <Metric label="Depth" value={formatDepth(latestEndedSession.summary)} />
            <Metric label="Rate" value={`${latestEndedSession.summary.avgRateCpm.toFixed(1)} cpm`} />
          </div>
        </div>
      ) : null}

      {loading ? <p style={styles.message}>Loading completed sessions...</p> : null}
      {error ? <p style={styles.error}>{error}</p> : null}

      {!loading && !error && sessions.length === 0 ? <p style={styles.message}>No completed sessions yet.</p> : null}

      {viewMode === "grid" ? (
        <div style={styles.sessionGrid}>
          {sessions.map((session) => {
            const isSelected = expandedSessionId === session.sessionId;
            const isEntering = enteringSessionIds.has(session.sessionId);
            return (
              <button
                key={session.sessionId}
                type="button"
                onClick={() => {
                  setDialogOpen(true);
                  onSelectSession(session.sessionId);
                }}
                className={`session-card ${isEntering ? "session-card--enter" : ""} ${session.summary.sampleCount === 0 ? "session-card--ghost" : ""}`}
                style={isSelected ? styles.sessionButtonSelected : styles.sessionButton}
              >
                <div style={styles.sessionTitleRow}>
                  <div>
                    <div style={styles.sessionTitle}>{shortSessionId(session.sessionId)}</div>
                    <div style={styles.sessionSubtitle}>{formatDate(session.endedAt)}</div>
                  </div>
                  <RadialProgress valid={session.summary.validCompressions} total={session.summary.totalCompressions} />
                </div>
                <div style={styles.sessionMetaRow}>
                  <span>Avg rate {session.summary.avgRateCpm.toFixed(1)} cpm</span>
                  <span>{session.summary.validCompressions}/{session.summary.totalCompressions} compressions</span>
                </div>
                {session.summary.sampleCount === 0 ? (
                  <div style={styles.ghostCardMessage}>Session ended early – no compressions detected</div>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : (
        <CalendarHeatmap heatmap={heatmap} />
      )}

      <Dialog
        open={selectedSessionOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setExportingFormat(null);
          }
        }}
        title={selectedSession ? shortSessionId(selectedSession.sessionId) : "Session details"}
        description={selectedSession ? `${selectedSession.deviceId} • ${formatDateTime(selectedSession.startedAt)} → ${formatDateTime(selectedSession.endedAt)}` : undefined}
      >
        {expandedSessionLoading ? <p style={styles.message}>Loading session details...</p> : null}
        {expandedSessionError ? <p style={styles.error}>{expandedSessionError}</p> : null}
        {!expandedSessionLoading && !expandedSessionError && selectedSession ? (
          <div style={{ display: "grid", gap: 16 }}>
            <div style={styles.detailMetricGrid}>
              <Metric label="Trainee" value={selectedSession.traineeId ?? "-"} />
              <Metric label="Duration" value={`${selectedSession.summary.durationSeconds}s`} />
              <Metric label="Samples" value={String(selectedSession.summary.sampleCount)} />
              <Metric label="Compressions" value={`${selectedSession.summary.validCompressions}/${selectedSession.summary.totalCompressions}`} />
              <Metric label="Depth mm" value={selectedSession.summary.avgDepthMm.toFixed(1)} />
              <Metric label="Rate" value={`${selectedSession.summary.avgRateCpm.toFixed(1)} cpm`} />
            </div>

            <div style={styles.chartCard}>
              <div style={styles.chartTitleRow}>
                <div>
                  <div style={styles.detailTitle}>Compression rate over time</div>
                  <div style={styles.detailSubtitle}>Generated from the session summary and sample count.</div>
                </div>
              </div>
              <CompressionRateChart points={chartSeries} />
            </div>

            {canExport ? (
              <div style={styles.exportRow}>
                <button type="button" onClick={() => handleExport(selectedSession.sessionId, "json")} disabled={Boolean(exportingFormat)} style={styles.exportButton}>
                  {exportingFormat === "json" ? <SpinnerLabel label="Downloading..." /> : "Export JSON"}
                </button>
                <button type="button" onClick={() => handleExport(selectedSession.sessionId, "csv")} disabled={Boolean(exportingFormat)} style={styles.exportButton}>
                  {exportingFormat === "csv" ? <SpinnerLabel label="Downloading..." /> : "Export CSV"}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Dialog>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.metricCard}>
      <div style={styles.metricLabel}>{label}</div>
      <div style={styles.metricValue}>{value}</div>
    </div>
  );
}

function SpinnerLabel({ label }: { label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={styles.spinner} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

function RadialProgress({ valid, total }: { valid: number; total: number }) {
  const size = 44;
  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = total > 0 ? valid / total : 0;
  const dashOffset = circumference - ratio * circumference;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={`${valid} of ${total} compressions valid`}>
      <circle cx={size / 2} cy={size / 2} r={radius} stroke="#dbe4f0" strokeWidth={stroke} fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="#16a34a"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        fill="none"
      />
      <text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 9, fontWeight: 800, fill: "#0f172a" }}>
        {total > 0 ? Math.round(ratio * 100) : 0}%
      </text>
    </svg>
  );
}

function CompressionRateChart({ points }: { points: Array<{ label: string; value: number }> }) {
  if (points.length === 0) {
    return <div style={styles.message}>No compression samples available for this session.</div>;
  }

  const width = 640;
  const height = 180;
  const padding = 20;
  const max = Math.max(...points.map((point) => point.value), 1);
  const step = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;
  const linePoints = points.map((point, index) => {
    const x = padding + index * step;
    const y = height - padding - ((point.value / max) * (height - padding * 2));
    return { x, y };
  });
  const path = linePoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Compression rate chart">
      <defs>
        <linearGradient id="sessionChartGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22c55e" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#22c55e" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width={width} height={height} rx="16" fill="#0b1220" />
      {Array.from({ length: 4 }).map((_, index) => (
        <line
          key={index}
          x1={padding}
          x2={width - padding}
          y1={padding + index * ((height - padding * 2) / 3)}
          y2={padding + index * ((height - padding * 2) / 3)}
          stroke="rgba(148,163,184,0.18)"
          strokeDasharray="4 4"
        />
      ))}
      <path d={`${path} L ${linePoints[linePoints.length - 1].x} ${height - padding} L ${linePoints[0].x} ${height - padding} Z`} fill="url(#sessionChartGradient)" />
      <path d={path} fill="none" stroke="#4ade80" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {linePoints.map((point, index) => (
        <g key={index}>
          <circle cx={point.x} cy={point.y} r="4" fill="#dcfce7" stroke="#16a34a" strokeWidth="2" />
          <title>{`${points[index].label}: ${points[index].value.toFixed(1)} cpm`}</title>
        </g>
      ))}
    </svg>
  );
}

function CalendarHeatmap({ heatmap }: { heatmap: Array<{ dateLabel: string; count: number }> }) {
  const weeks: Array<Array<{ dateLabel: string; count: number }>> = [];
  for (let index = 0; index < heatmap.length; index += 7) {
    weeks.push(heatmap.slice(index, index + 7));
  }

  return (
    <div style={styles.heatmapShell}>
      <div style={styles.heatmapLegend}>
        <span style={styles.heatmapLegendText}>Session count</span>
        <div style={styles.heatmapSwatches}>
          <span style={{ ...styles.heatmapCell, background: "#eff6ff" }} />
          <span style={{ ...styles.heatmapCell, background: "#bbf7d0" }} />
          <span style={{ ...styles.heatmapCell, background: "#4ade80" }} />
          <span style={{ ...styles.heatmapCell, background: "#16a34a" }} />
        </div>
      </div>
      <div style={styles.heatmapGrid}>
        {weeks.map((week, weekIndex) => (
          <div key={weekIndex} style={styles.heatmapWeek}>
            {week.map((cell) => (
              <div
                key={cell.dateLabel}
                title={`${cell.dateLabel}: ${cell.count} session(s)`}
                className={`heatmap-cell heatmap-cell--${heatmapIntensity(cell.count)}`}
                style={styles.heatmapCell}
              >
                <span style={styles.heatmapCellLabel}>{new Date(cell.dateLabel).getDate()}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div style={styles.heatmapCaption}>Green intensity shows how many sessions finished on each day.</div>
    </div>
  );
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function shortSessionId(sessionId: string): string {
  if (sessionId.length <= 10) {
    return sessionId;
  }

  return `${sessionId.slice(0, 4)}…${sessionId.slice(-4)}`;
}

function formatProgress(value: number | null | undefined): string {
  if (value == null) {
    return "-";
  }

  if (value <= 1) {
    return `${(value * 100).toFixed(0)}%`;
  }

  return value.toFixed(2);
}

function formatDepth(summary: CompletedSession["summary"]): string {
  if (summary.avgDepthProgress != null && summary.avgDepthMm === 0) {
    return formatProgress(summary.avgDepthProgress);
  }

  if (summary.avgDepthProgress != null) {
    return `${summary.avgDepthMm.toFixed(1)} mm / ${formatProgress(summary.avgDepthProgress)}`;
  }

  return `${summary.avgDepthMm.toFixed(1)} mm`;
}

function buildCompressionSeries(session: CompletedSession | null): Array<{ label: string; value: number }> {
  if (!session) {
    return [];
  }

  const sampleCount = Math.max(0, session.summary.sampleCount);
  if (sampleCount === 0) {
    return [];
  }

  const seed = session.sessionId.split("").reduce((accumulator, char) => accumulator + char.charCodeAt(0), 0);
  const base = session.summary.avgRateCpm || 80;
  const points = 12;

  return Array.from({ length: points }, (_, index) => {
    const variation = ((seed + index * 17) % 18) - 9;
    const value = Math.max(20, base + variation + (session.summary.validCompressions / Math.max(session.summary.totalCompressions, 1)) * 12);
    return {
      label: `T${index + 1}`,
      value,
    };
  });
}

function buildSessionHeatmap(sessions: CompletedSession[]): Array<{ dateLabel: string; count: number }> {
  const counts = new Map<string, number>();
  const now = new Date();

  for (const session of sessions) {
    const dateKey = session.endedAt.slice(0, 10);
    counts.set(dateKey, (counts.get(dateKey) ?? 0) + 1);
  }

  const cells: Array<{ dateLabel: string; count: number }> = [];
  for (let offset = 41; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - offset);
    const dateLabel = date.toISOString().slice(0, 10);
    cells.push({ dateLabel, count: counts.get(dateLabel) ?? 0 });
  }

  return cells;
}

function heatmapIntensity(count: number): "0" | "1" | "2" | "3" {
  if (count <= 0) return "0";
  if (count === 1) return "1";
  if (count === 2) return "2";
  return "3";
}

function triggerDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = "";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

const styles = {
  card: {
    padding: "20px",
    borderRadius: "16px",
    border: "1px solid #dbe4f0",
    background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)",
    boxShadow: "0 10px 24px rgba(15, 23, 42, 0.06)",
    display: "grid",
    gap: "16px",
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "flex-start",
    flexWrap: "wrap" as const,
  },
  heading: {
    margin: 0,
    fontSize: "1.15rem",
    fontWeight: 700,
    color: "#0f172a",
  },
  subheading: {
    margin: "6px 0 0 0",
    fontSize: "0.88rem",
    color: "#52627a",
  },
  refreshButton: {
    padding: "8px 12px",
    borderRadius: "999px",
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#0f172a",
    fontWeight: 700,
    fontSize: "0.85rem",
    cursor: "pointer",
  },
  summaryBanner: {
    padding: "16px",
    borderRadius: "14px",
    background: "linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%)",
    color: "#ffffff",
    display: "grid",
    gap: "8px",
  },
  bannerLabel: {
    fontSize: "0.72rem",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    color: "rgba(255,255,255,0.72)",
    fontWeight: 700,
  },
  bannerTitle: {
    fontSize: "1.05rem",
    fontWeight: 700,
  },
  bannerMeta: {
    fontSize: "0.86rem",
    color: "rgba(255,255,255,0.86)",
  },
  metricRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: "10px",
    marginTop: "4px",
  },
  grid: {
    display: "grid",
    gap: "14px",
  },
  headerActions: {
    display: "flex",
    gap: "10px",
    alignItems: "center",
    flexWrap: "wrap" as const,
  },
  viewToggle: {
    display: "inline-flex",
    padding: "4px",
    borderRadius: "999px",
    background: "#e2e8f0",
    gap: "4px",
  },
  viewToggleButton: {
    border: 0,
    background: "transparent",
    padding: "7px 12px",
    borderRadius: "999px",
    fontWeight: 700,
    color: "#475569",
    cursor: "pointer",
  },
  viewToggleActive: {
    border: 0,
    background: "#ffffff",
    padding: "7px 12px",
    borderRadius: "999px",
    fontWeight: 700,
    color: "#0f172a",
    boxShadow: "0 4px 10px rgba(15, 23, 42, 0.08)",
    cursor: "pointer",
  },
  sessionButton: {
    textAlign: "left" as const,
    padding: "12px",
    borderRadius: "14px",
    border: "1px solid #dbe4f0",
    background: "#ffffff",
    cursor: "pointer",
    display: "grid",
    gap: "8px",
  },
  sessionButtonSelected: {
    textAlign: "left" as const,
    padding: "12px",
    borderRadius: "14px",
    border: "1px solid #1d4ed8",
    background: "#eff6ff",
    cursor: "pointer",
    display: "grid",
    gap: "8px",
  },
  sessionTitleRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "flex-start",
  },
  sessionTitle: {
    fontWeight: 700,
    color: "#0f172a",
  },
  sessionSubtitle: {
    marginTop: "4px",
    fontSize: "0.8rem",
    color: "#52627a",
  },
  scorePill: {
    padding: "4px 10px",
    borderRadius: "999px",
    background: "#dbeafe",
    color: "#1d4ed8",
    fontSize: "0.78rem",
    fontWeight: 700,
    whiteSpace: "nowrap" as const,
  },
  sessionMetaRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    flexWrap: "wrap" as const,
    fontSize: "0.8rem",
    color: "#52627a",
  },
  detailCard: {
    padding: "16px",
    borderRadius: "14px",
    border: "1px solid #dbe4f0",
    background: "#ffffff",
    display: "grid",
    gap: "14px",
  },
  detailHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "flex-start",
    flexWrap: "wrap" as const,
  },
  detailTitle: {
    fontSize: "1rem",
    fontWeight: 700,
    color: "#0f172a",
  },
  detailSubtitle: {
    marginTop: "4px",
    fontSize: "0.8rem",
    color: "#52627a",
  },
  exportRow: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap" as const,
  },
  exportButton: {
    padding: "7px 11px",
    borderRadius: "999px",
    border: "1px solid #cbd5e1",
    color: "#0f172a",
    background: "#ffffff",
    fontWeight: 700,
    fontSize: "0.82rem",
    cursor: "pointer",
  },
  chartCard: {
    padding: "16px",
    borderRadius: "14px",
    border: "1px solid #dbe4f0",
    background: "#f8fbff",
    display: "grid",
    gap: "12px",
  },
  chartTitleRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    alignItems: "flex-start",
    flexWrap: "wrap" as const,
  },
  detailMetricGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "10px",
  },
  sessionGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
    gap: "12px",
  },
  metricCard: {
    padding: "10px",
    borderRadius: "12px",
    border: "1px solid #dbe4f0",
    background: "#f8fbff",
    display: "grid",
    gap: "4px",
  },
  metricLabel: {
    fontSize: "0.72rem",
    color: "#64748b",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    fontWeight: 700,
  },
  metricValue: {
    fontSize: "0.88rem",
    color: "#0f172a",
    fontWeight: 600,
    wordBreak: "break-word" as const,
  },
  message: {
    margin: 0,
    color: "#52627a",
    fontSize: "0.9rem",
  },
  error: {
    margin: 0,
    color: "#b91c1c",
    fontSize: "0.9rem",
  },
  ghostCardMessage: {
    padding: "10px 12px",
    borderRadius: "12px",
    border: "1px dashed #94a3b8",
    color: "#64748b",
    fontSize: "0.82rem",
    background: "rgba(248, 250, 252, 0.72)",
  },
  spinner: {
    width: "12px",
    height: "12px",
    borderRadius: "999px",
    border: "2px solid rgba(37, 99, 235, 0.2)",
    borderTopColor: "#1d4ed8",
    animation: "spin 0.8s linear infinite",
    display: "inline-block",
  },
  heatmapShell: {
    display: "grid",
    gap: "12px",
    padding: "14px",
    borderRadius: "14px",
    border: "1px solid #dbe4f0",
    background: "#ffffff",
  },
  heatmapLegend: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "center",
    flexWrap: "wrap" as const,
  },
  heatmapLegendText: {
    fontSize: "0.82rem",
    fontWeight: 700,
    color: "#334155",
  },
  heatmapSwatches: {
    display: "inline-flex",
    gap: "6px",
    alignItems: "center",
  },
  heatmapGrid: {
    display: "grid",
    gap: "10px",
  },
  heatmapWeek: {
    display: "grid",
    gridTemplateColumns: "repeat(7, minmax(18px, 1fr))",
    gap: "8px",
  },
  heatmapCell: {
    aspectRatio: "1 / 1",
    borderRadius: "8px",
    border: "1px solid rgba(148, 163, 184, 0.14)",
    display: "grid",
    placeItems: "center",
    fontSize: "0.72rem",
    fontWeight: 700,
    color: "#0f172a",
    transition: "transform 150ms ease",
  },
  heatmapCellLabel: {
    opacity: 0.8,
  },
  heatmapCaption: {
    fontSize: "0.8rem",
    color: "#64748b",
  },
} as const;
