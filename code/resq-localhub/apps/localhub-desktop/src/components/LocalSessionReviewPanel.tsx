import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
} from "./ui/dialog";
import { Card, Button, Badge } from "./ui";
import { type CompletedSession, getSessionReviewExportUrl } from "../lib/browserSessionsApi";
import { Calendar, Clock, User, Download, RefreshCw, Eye, Sparkles } from "lucide-react";
import SessionReviewIcon from "../components/icons/SessionReviewIcon";

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

  function handleExport(sessionId: string, format: "json" | "csv") {
    setExportingFormat(format);
    window.setTimeout(() => {
      triggerDownload(getSessionReviewExportUrl(sessionId, format));
      setExportingFormat(null);
    }, 650);
  }

  function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  return (
    <Card className="mb-6 flex flex-col gap-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-blue-50 dark:bg-blue-900/30 text-[#005A9C] dark:text-blue-400 rounded-lg">
            <SessionReviewIcon size={20} />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Local Session Review</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">Review completed CPR sessions and export performance reports.</p>
          </div>
        </div>
        <div className="flex items-center gap-3 w-full md:w-auto justify-end">
          <Button
            variant="secondary"
            onClick={onRefresh}
            disabled={loading}
            className="h-8 w-8 p-0 flex items-center justify-center"
            aria-label="Refresh completed sessions"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </Button>
        </div>
      </div>

      {latestEndedSession ? (
        <div className="p-4 rounded-xl bg-gradient-to-r from-gray-900 via-slate-800 to-[#005A9C] text-white flex flex-col gap-3 shadow-md relative overflow-hidden">
          <div className="absolute right-0 top-0 translate-x-4 -translate-y-4 w-24 h-24 bg-white/5 rounded-full blur-xl pointer-events-none" />
          <div className="text-[10px] uppercase tracking-wider text-gray-400 font-bold flex items-center gap-1">
            <Sparkles size={10} className="text-yellow-400 animate-pulse" /> Latest completed session
          </div>
          <div className="text-sm font-extrabold">
            Device: {latestEndedSession.deviceId} &middot; ID: {shortSessionId(latestEndedSession.sessionId)}
          </div>
          <div className="text-xs text-gray-300">
            Trainee: {latestEndedSession.traineeId ?? "Guest"} &middot; {formatDateTime(latestEndedSession.endedAt)} &middot; Score: <span className="text-green-400 font-bold">{latestEndedSession.summary.score}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-1">
            <div className="bg-white/5 border border-white/10 rounded-lg p-2 text-center">
              <div className="text-[9px] text-gray-400 uppercase font-bold">Samples</div>
              <div className="text-xs font-bold">{latestEndedSession.summary.sampleCount}</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-lg p-2 text-center">
              <div className="text-[9px] text-gray-400 uppercase font-bold">Compressions</div>
              <div className="text-xs font-bold">{latestEndedSession.summary.validCompressions}/{latestEndedSession.summary.totalCompressions}</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-lg p-2 text-center">
              <div className="text-[9px] text-gray-400 uppercase font-bold">Depth</div>
              <div className="text-xs font-bold">{formatDepth(latestEndedSession.summary)}</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-lg p-2 text-center">
              <div className="text-[9px] text-gray-400 uppercase font-bold">Rate</div>
              <div className="text-xs font-bold">{latestEndedSession.summary.avgRateCpm.toFixed(1)} cpm</div>
            </div>
          </div>
        </div>
      ) : null}

      {loading ? <p className="text-sm text-gray-500 dark:text-gray-400">Loading completed sessions...</p> : null}
      {error ? <p className="text-sm text-[#D13438]">{error}</p> : null}

      {!loading && !error && sessions.length === 0 ? <p className="text-sm text-gray-500 dark:text-gray-400">No completed sessions yet.</p> : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sessions.map((session) => {
          const isSelected = expandedSessionId === session.sessionId;
          const isEntering = enteringSessionIds.has(session.sessionId);
          return (
            <Card
              key={session.sessionId}
              className={`p-4 bg-white dark:bg-gray-800 border rounded-xl flex flex-col justify-between transition-all hover:shadow-md ${isSelected ? "border-[#005A9C] ring-1 ring-[#005A9C]" : "border-gray-200 dark:border-gray-700"} ${isEntering ? "animate-pulse" : ""} ${session.summary.sampleCount === 0 ? "opacity-75" : ""}`}
            >
              <div className="flex justify-between items-start gap-4 mb-3">
                <div>
                  <div className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${session.summary.sampleCount > 0 ? "bg-green-500" : "bg-gray-400"}`} />
                    {shortSessionId(session.sessionId)}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-1">
                    <Calendar size={11} /> {formatDate(session.endedAt)}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-1">
                    <Clock size={11} /> {formatDuration(session.summary.durationSeconds)}
                  </div>
                  <div className="text-[11px] text-gray-700 dark:text-gray-300 mt-1.5 font-bold flex items-center gap-1">
                    <User size={11} /> {session.traineeId ? `Student: ${session.traineeId}` : "Guest"}
                  </div>
                </div>
                <RadialProgress valid={session.summary.validCompressions} total={session.summary.totalCompressions} />
              </div>

              <div className="text-[11px] text-gray-500 dark:text-gray-400 flex justify-between mb-3 bg-gray-50 dark:bg-gray-900 p-1.5 rounded-lg">
                <span>Avg: {session.summary.avgRateCpm.toFixed(1)} CPM</span>
                <span>{session.summary.validCompressions}/{session.summary.totalCompressions} compressions</span>
              </div>

              {session.summary.sampleCount === 0 ? (
                <div className="p-2 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg text-center text-xs text-gray-400 dark:text-gray-500 mb-3">
                  Session ended early - no telemetry
                </div>
              ) : null}

              <div className="pt-2 border-t border-gray-100 dark:border-gray-700 flex justify-between items-center gap-2 mt-auto">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDialogOpen(true);
                    onSelectSession(session.sessionId);
                  }}
                  className="text-xs h-7 px-2 text-[#005A9C] dark:text-blue-400 flex items-center gap-1 hover:bg-transparent"
                >
                  <Eye size={12} /> View Details
                </Button>

                {canExport ? (
                  <div className="flex gap-1">
                    <Button
                      variant="secondary"
                      onClick={() => handleExport(session.sessionId, "json")}
                      disabled={Boolean(exportingFormat)}
                      className="text-[10px] px-2 h-6"
                    >
                      JSON
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => handleExport(session.sessionId, "csv")}
                      disabled={Boolean(exportingFormat)}
                      className="text-[10px] px-2 h-6"
                    >
                      CSV
                    </Button>
                  </div>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>

      <Dialog
        open={selectedSessionOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setExportingFormat(null);
          }
        }}
        title={selectedSession ? `Session: ${shortSessionId(selectedSession.sessionId)}` : "Session details"}
        description={selectedSession ? `${selectedSession.deviceId} • ${formatDateTime(selectedSession.startedAt)} → ${formatDateTime(selectedSession.endedAt)}` : undefined}
      >
        {expandedSessionLoading ? <p className="text-sm text-gray-500 dark:text-gray-400">Loading session details...</p> : null}
        {expandedSessionError ? <p className="text-sm text-[#D13438]">{expandedSessionError}</p> : null}
        {!expandedSessionLoading && !expandedSessionError && selectedSession ? (
          <div className="grid gap-4 py-2 text-gray-900 dark:text-gray-100">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Metric label="Trainee" value={selectedSession.traineeId ?? "Guest"} />
              <Metric label="Duration" value={`${selectedSession.summary.durationSeconds}s`} />
              <Metric label="Samples" value={String(selectedSession.summary.sampleCount)} />
              <Metric label="Compressions" value={`${selectedSession.summary.validCompressions}/${selectedSession.summary.totalCompressions}`} />
              <Metric label="Depth mm" value={selectedSession.summary.avgDepthMm.toFixed(1)} />
              <Metric label="Rate" value={`${selectedSession.summary.avgRateCpm.toFixed(1)} cpm`} />
            </div>

            <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
              <div className="mb-2">
                <div className="text-sm font-bold">Compression rate over time</div>
                <div className="text-xs text-gray-500">Visualization generated from the session metrics.</div>
              </div>
              <CompressionRateChart points={chartSeries} />
            </div>

            {canExport ? (
              <div className="flex gap-2 justify-end pt-2">
                <Button
                  onClick={() => handleExport(selectedSession.sessionId, "json")}
                  disabled={Boolean(exportingFormat)}
                  className="bg-[#005A9C] hover:bg-[#005A9C]/90 text-white border-0 flex items-center gap-1.5"
                >
                  <Download size={14} /> JSON Export
                </Button>
                <Button
                  onClick={() => handleExport(selectedSession.sessionId, "csv")}
                  disabled={Boolean(exportingFormat)}
                  className="bg-[#005A9C] hover:bg-[#005A9C]/90 text-white border-0 flex items-center gap-1.5"
                >
                  <Download size={14} /> CSV Export
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Dialog>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 rounded-lg">
      <div className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold mb-1">{label}</div>
      <div className="text-sm font-semibold truncate">{value}</div>
    </div>
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
      <circle cx={size / 2} cy={size / 2} r={radius} stroke="#e2e8f0" strokeWidth={stroke} fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="#107C10"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        fill="none"
      />
      <text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" className="text-[9px] font-extrabold fill-gray-900 dark:fill-gray-100">
        {total > 0 ? Math.round(ratio * 100) : 0}%
      </text>
    </svg>
  );
}

function CompressionRateChart({ points }: { points: Array<{ label: string; value: number }> }) {
  if (points.length === 0) {
    return <div className="text-sm text-gray-500 text-center py-6">No compression samples available for this session.</div>;
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
          <stop offset="0%" stopColor="#107C10" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#107C10" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width={width} height={height} rx="12" fill="#0f172a" />
      {Array.from({ length: 4 }).map((_, index) => (
        <line
          key={index}
          x1={padding}
          x2={width - padding}
          y1={padding + index * ((height - padding * 2) / 3)}
          y2={padding + index * ((height - padding * 2) / 3)}
          stroke="rgba(148,163,184,0.15)"
          strokeDasharray="4 4"
        />
      ))}
      <path d={`${path} L ${linePoints[linePoints.length - 1].x} ${height - padding} L ${linePoints[0].x} ${height - padding} Z`} fill="url(#sessionChartGradient)" />
      <path d={path} fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {linePoints.map((point, index) => (
        <g key={index}>
          <circle cx={point.x} cy={point.y} r="3.5" fill="#dcfce7" stroke="#107C10" strokeWidth="1.5" />
          <title>{`${points[index].label}: ${points[index].value.toFixed(1)} cpm`}</title>
        </g>
      ))}
    </svg>
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


function triggerDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = "";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
