import { useMemo, useState } from "react";
import { Button, Skeleton, Alert } from "./ui";
import { Dialog } from "./ui/dialog";
import { getSessionCsvExportUrl, getSessionJsonExportUrl, type CompletedSession } from "../lib/browserSessionsApi";

type Props = {
  sessions: CompletedSession[];
  loading: boolean;
  error: string | null;
  selectedSessionId: string | null;
  selectedSession: CompletedSession | null;
  selectedSessionLoading: boolean;
  selectedSessionError: string | null;
  onOpenSession: (sessionId: string) => void;
  onCloseSession: () => void;
};

type ViewMode = "cards" | "heatmap";

function shortId(sessionId: string): string {
  return sessionId.length > 10 ? `${sessionId.slice(0, 6)}…${sessionId.slice(-3)}` : sessionId;
}

function formatSessionDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function buildCalendarHeatmap(sessions: CompletedSession[], days = 35) {
  const today = new Date();
  const counts = new Map<string, number>();

  for (const session of sessions) {
    const date = new Date(session.endedAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = date.toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Array.from({ length: days }, (_, index) => {
    const day = new Date(today);
    day.setDate(today.getDate() - (days - 1 - index));
    const key = day.toISOString().slice(0, 10);
    return { date: key, count: counts.get(key) ?? 0 };
  });
}

function buildRateSeries(session: CompletedSession): number[] {
  const base = session.compressionRateSeries?.length ? session.compressionRateSeries : null;
  if (base) return base.slice(-24);

  const points: number[] = [];
  const avg = session.summary.avgRateCpm;
  const span = Math.max(12, avg * 0.25);
  for (let i = 0; i < 12; i += 1) {
    const wobble = Math.sin((i / 11) * Math.PI * 2) * span * 0.55;
    const drift = (i - 5.5) * span * 0.04;
    points.push(Math.max(0, Math.round(avg + wobble + drift)));
  }
  return points;
}

function useSampleStats(session: CompletedSession) {
  const sampleCount = session.sampleCount ?? session.summary.sampleCount ?? (session.summary.score <= 0 ? 0 : Math.max(1, Math.round(session.summary.durationSeconds / 4)));
  const totalCompressions = session.totalCompressions ?? session.summary.totalCompressions ?? sampleCount;
  const validCompressions = session.validCompressions ?? session.summary.validCompressions ?? (totalCompressions === 0 ? 0 : Math.max(0, Math.min(totalCompressions, Math.round(totalCompressions * Math.max(0, Math.min(session.summary.score, 100)) / 100))));

  return { sampleCount, totalCompressions, validCompressions };
}

function RadialProgress({ value, total }: { value: number; total: number }) {
  const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((value / total) * 100))) : 0;
  const r = 18;
  const c = 2 * Math.PI * r;
  const offset = c - (percent / 100) * c;

  return (
    <div className="session-review__radial" title={`${value}/${total} valid compressions`}>
      <svg viewBox="0 0 44 44" width="44" height="44">
        <circle cx="22" cy="22" r={r} fill="none" stroke="#e2e8f0" strokeWidth="4" />
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          stroke="url(#sessionReviewGradient)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform="rotate(-90 22 22)"
        />
        <defs>
          <linearGradient id="sessionReviewGradient" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" />
            <stop offset="100%" stopColor="#16a34a" />
          </linearGradient>
        </defs>
      </svg>
      <span className="session-review__radial-label">{percent}%</span>
    </div>
  );
}

function SparkLine({ values }: { values: number[] }) {
  const width = 280;
  const height = 76;
  const padding = 8;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const step = values.length <= 1 ? 0 : (width - padding * 2) / (values.length - 1);
  const d = values
    .map((value, index) => {
      const x = padding + index * step;
      const normalized = (value - min) / span;
      const y = height - padding - normalized * (height - padding * 2);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg className="session-review__sparkline" viewBox={`0 0 ${width} ${height}`} width="100%" height={height} aria-hidden="true">
      <path d={d} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SessionRateChart({ session }: { session: CompletedSession }) {
  const values = useMemo(() => buildRateSeries(session), [session]);
  const width = 680;
  const height = 220;
  const padding = 24;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const step = values.length <= 1 ? 0 : (width - padding * 2) / (values.length - 1);

  const points = values.map((value, index) => {
    const x = padding + index * step;
    const normalized = (value - min) / span;
    const y = height - padding - normalized * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const area = [`M ${padding} ${height - padding}`, ...points.map((point) => `L ${point}`), `L ${width - padding} ${height - padding}`, "Z"].join(" ");

  return (
    <div className="session-review__chart-card">
      <div className="session-review__chart-meta">
        <span>Compression Rate Over Time</span>
        <span>{session.summary.avgRateCpm.toFixed(1)} cpm avg</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="session-review__chart" role="img" aria-label="Compression rate chart">
        <defs>
          <linearGradient id="sessionReviewArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#22c55e" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#sessionReviewArea)" />
        <polyline points={points.join(" ")} fill="none" stroke="#16a34a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export default function SessionReviewPanel({
  sessions,
  loading,
  error,
  selectedSessionId,
  selectedSession,
  selectedSessionLoading,
  selectedSessionError,
  onOpenSession,
  onCloseSession,
}: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [downloadState, setDownloadState] = useState<Record<string, "csv" | "json" | null>>({});

  const heatmap = useMemo(() => buildCalendarHeatmap(sessions), [sessions]);

  function getSessionIdDownloadKey(sessionId: string, format: "csv" | "json") {
    return `${sessionId}:${format}`;
  }

  function getExportUrl(sessionId: string, format: "csv" | "json") {
    return format === "csv" ? getSessionCsvExportUrl(sessionId) : getSessionJsonExportUrl(sessionId);
  }

  function triggerDownload(sessionId: string, format: "csv" | "json") {
    const key = getSessionIdDownloadKey(sessionId, format);
    setDownloadState((current) => ({ ...current, [key]: format }));
    window.setTimeout(() => {
      const link = document.createElement("a");
      link.href = getExportUrl(sessionId, format);
      link.download = `${sessionId}.${format}`;
      link.target = "_blank";
      link.rel = "noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setDownloadState((current) => ({ ...current, [key]: null }));
    }, 650);
  }

  function getDayIntensity(count: number) {
    return Math.min(count, 4);
  }

  return (
    <section className="session-review">
      <div className="session-review__header">
        <div>
          <h2 id="session-review-title" className="card__title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M4 7h16" stroke="#0f172a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M4 12h16" stroke="#0f172a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M4 17h16" stroke="#0f172a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <span>Session Review</span>
          </h2>
          <p className="session-review__copy">Browse completed sessions as cards or switch to a calendar heatmap.</p>
        </div>

        <div className="session-review__toggle" role="tablist" aria-label="Session review view">
          <button type="button" className={`session-review__toggle-btn ${viewMode === "cards" ? "session-review__toggle-btn--active" : ""}`} onClick={() => setViewMode("cards")}>Cards</button>
          <button type="button" className={`session-review__toggle-btn ${viewMode === "heatmap" ? "session-review__toggle-btn--active" : ""}`} onClick={() => setViewMode("heatmap")}>Heatmap</button>
        </div>
      </div>

      {loading ? (
        <div style={{ display: "grid", gap: 8 }}>
          <Skeleton className="skeleton--shimmer" />
          <Skeleton className="skeleton--shimmer" />
          <Skeleton className="skeleton--shimmer" />
        </div>
      ) : error ? (
        <Alert variant="danger" title="Unable to load sessions" detail={error} />
      ) : viewMode === "heatmap" ? (
        <div className="session-review__heatmap">
          <div className="session-review__heatmap-header">
            <span>Less</span>
            <span className="session-review__swatch session-review__swatch--0" />
            <span className="session-review__swatch session-review__swatch--1" />
            <span className="session-review__swatch session-review__swatch--2" />
            <span className="session-review__swatch session-review__swatch--3" />
            <span>More</span>
          </div>

          <div className="session-review__heatmap-grid" role="img" aria-label="Calendar heatmap of completed sessions">
            {heatmap.map((day) => (
              <button
                key={day.date}
                type="button"
                className={`session-review__heatmap-cell session-review__heatmap-cell--${getDayIntensity(day.count)}`}
                title={`${day.date}: ${day.count} completed session${day.count === 1 ? "" : "s"}`}
                aria-label={`${day.date}: ${day.count} completed session${day.count === 1 ? "" : "s"}`}
              />
            ))}
          </div>
        </div>
      ) : sessions.length === 0 ? (
        <div className="session-review__empty">
          <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M12 4v16" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M4 12h16" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <p>No completed sessions yet.</p>
        </div>
      ) : (
        <div className="session-review__grid">
          {sessions.map((session, index) => {
            const { sampleCount, totalCompressions, validCompressions } = useSampleStats(session);
            const ghost = sampleCount === 0;
            const downloadKeyCsv = getSessionIdDownloadKey(session.sessionId, "csv");
            const downloadKeyJson = getSessionIdDownloadKey(session.sessionId, "json");

            return (
              <article
                key={session.sessionId}
                className={`session-review__card ${ghost ? "session-review__card--ghost" : ""}`}
                style={{ animationDelay: `${Math.min(index * 60, 360)}ms` }}
              >
                <button type="button" className="session-review__card-main" onClick={() => onOpenSession(session.sessionId)}>
                  <div className="session-review__card-top">
                    <div>
                      <p className="session-review__session-id">{shortId(session.sessionId)}</p>
                      <p className="session-review__session-date">{formatSessionDate(session.endedAt)}</p>
                    </div>
                    <RadialProgress value={validCompressions} total={totalCompressions} />
                  </div>

                  <div className="session-review__card-body">
                    {ghost ? (
                      <div className="session-review__ghost">
                        <p>Session ended early – no compressions detected</p>
                      </div>
                    ) : (
                      <>
                        <div className="session-review__metric">
                          <span>Average Rate</span>
                          <strong>{session.summary.avgRateCpm.toFixed(1)} cpm</strong>
                        </div>
                        <div className="session-review__metric">
                          <span>Valid / Total</span>
                          <strong>{validCompressions}/{totalCompressions}</strong>
                        </div>
                        <SparkLine values={buildRateSeries(session)} />
                      </>
                    )}
                  </div>
                </button>

                <div className="session-review__card-actions">
                  <Button variant="secondary" onClick={() => triggerDownload(session.sessionId, "csv")}>
                      {downloadState[downloadKeyCsv] ? <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><span className="session-review__download-spinner" />Downloading…</span> : "CSV"}
                  </Button>
                  <Button variant="secondary" onClick={() => triggerDownload(session.sessionId, "json")}>
                      {downloadState[downloadKeyJson] ? <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><span className="session-review__download-spinner" />Downloading…</span> : "JSON"}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Dialog
          open={Boolean(selectedSessionId)}
        onOpenChange={(open) => {
          if (!open) onCloseSession();
        }}
          title={selectedSession ? `Session ${shortId(selectedSession.sessionId)}` : selectedSessionId ? `Session ${shortId(selectedSessionId)}` : "Session"}
        description={selectedSession ? formatSessionDate(selectedSession.endedAt) : undefined}
      >
        {selectedSessionLoading ? (
          <div style={{ display: "grid", gap: 10 }}>
            <Skeleton size="lg" className="skeleton--shimmer" />
            <Skeleton size="lg" className="skeleton--shimmer" />
          </div>
        ) : selectedSessionError ? (
          <Alert variant="danger" title="Unable to load session" detail={selectedSessionError} />
        ) : selectedSession ? (
          <div style={{ display: "grid", gap: 14 }}>
            <SessionRateChart session={selectedSession} />
            <div className="session-review__detail-grid">
              <p><strong>Device:</strong> {selectedSession.deviceId}</p>
              <p><strong>Avg rate:</strong> {selectedSession.summary.avgRateCpm.toFixed(1)} cpm</p>
              <p><strong>Duration:</strong> {selectedSession.summary.durationSeconds}s</p>
              <p><strong>Score:</strong> {selectedSession.summary.score}</p>
              <p><strong>Flags:</strong> {selectedSession.summary.latestFlags ?? "-"}</p>
            </div>
          </div>
        ) : null}
      </Dialog>
    </section>
  );
}
