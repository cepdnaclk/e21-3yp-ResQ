import { useEffect, useState, useMemo } from "react";
import { fetchCompletedSessions, fetchSyncQueue } from "../../api/sessionsApi";
import type { CompletedSession, SyncQueueItem } from "../../types/session";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";
import PageHeader from "../../components/ui/PageHeader";
import StatusBadge from "../../components/ui/StatusBadge";
import {
  formatDateTime,
  formatDuration,
  getScoreLabel,
  getScoreTone,
} from "../../utils/userFriendlyLabels";

function getSyncBadgeProps(status?: 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'RETRY_LATER' | 'SKIPPED'): { tone: "success" | "info" | "warning" | "danger" | "muted"; label: string } {
  switch (status) {
    case "SYNCED":
      return {
        label: "Synced",
        tone: "success" as const,
      };

    case "SYNCING":
      return {
        label: "Syncing",
        tone: "info" as const,
      };

    case "PENDING":
      return {
        label: "Pending sync",
        tone: "warning" as const,
      };

    case "RETRY_LATER":
      return { tone: "warning", label: "Will retry" };
    case "SKIPPED":
      return { tone: "muted", label: "Skipped" };
    default:
      return {
        label: "Local only",
        tone: "muted" as const,
      };
  }
}

type RecentSessionsPageProps = {
  onSelectSession: (sessionId: string) => void;
};

export function RecentSessionsPage({ onSelectSession }: RecentSessionsPageProps) {
  const [sessions, setSessions] = useState<CompletedSession[]>([]);
  const [syncQueue, setSyncQueue] = useState<SyncQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  async function loadSessions() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCompletedSessions();
      setSessions(data);
      
      try {
        const queueData = await fetchSyncQueue();
        setSyncQueue(queueData);
      } catch (err) {
        console.warn("Could not retrieve sync queue, defaulting to locally saved status:", err);
        setSyncQueue([]);
      }
    } catch (err) {
      setError("Failed to retrieve completed session history.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSessions();
  }, []);

  // Filter completed sessions by trainee identifier or course
  const filteredSessions = useMemo(() => {
    if (!searchTerm.trim()) return sessions;
    const lowerSearch = searchTerm.toLowerCase();
    return sessions.filter((s) => {
      const traineeMatch = (s.traineeId || "").toLowerCase().includes(lowerSearch);
      const courseMatch = (s.courseId || "").toLowerCase().includes(lowerSearch);
      const scenarioMatch = (s.scenario || "").toLowerCase().includes(lowerSearch);
      return traineeMatch || courseMatch || scenarioMatch;
    });
  }, [sessions, searchTerm]);

  if (loading) {
    return <LoadingState message="Loading session history..." />;
  }

  return (
    <div className="app-page space-y-6">
      <PageHeader
        title="Session History"
        subtitle="Review past CPR training performance records and export report logs."
      />

      {error && (
        <Card className="border-rose-100 bg-rose-50/50 p-6 text-rose-800 max-w-lg mx-auto text-center animate-fadeIn">
          <p className="text-sm font-semibold">{error}</p>
          <Button variant="secondary" size="sm" className="mt-4 bg-white" onClick={loadSessions}>
            Retry Load
          </Button>
        </Card>
      )}

      {/* Search and Filters Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-slate-100 p-4 rounded-2xl shadow-[0_4px_12px_rgba(15,23,42,0.01)]">
        <div className="relative flex-1 max-w-md">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 pointer-events-none">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </span>
          <input
            type="text"
            placeholder="Search by trainee identifier or course..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="block w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-xs text-slate-800 bg-slate-50/50 hover:bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 font-medium transition-colors"
          />
        </div>
        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider pr-2">
          Total Records: {filteredSessions.length}
        </div>
      </div>

      {/* Premium Table Card */}
      {!error && filteredSessions.length === 0 ? (
        <Card className="text-center py-16 border border-dashed border-slate-200 max-w-md mx-auto">
          <div className="text-3xl font-black text-slate-300 mb-2">⏱</div>
          <p className="text-slate-500 text-sm font-semibold">No training sessions found.</p>
          <p className="text-slate-400 text-xs mt-1">Try refining your search keyword or complete a practice cycle.</p>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 2xl:hidden">
            {filteredSessions.map((session) => {
              const score = session.summary?.score ?? 0;
              const scoreTone = getScoreTone(score);
              const scoreBadgeTone: "success" | "info" | "warning" | "danger" | "muted" =
                scoreTone === "excellent"
                  ? "success"
                  : scoreTone === "good"
                    ? "info"
                    : scoreTone === "fair"
                      ? "warning"
                      : "danger";
              const queueItem = syncQueue.find((item) => item.entityId === session.sessionId);
              const syncProps = getSyncBadgeProps(queueItem?.syncStatus);

              return (
                <Card key={session.sessionId} className="space-y-4 border border-slate-100 p-4 sm:p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="break-all font-mono text-xs font-bold text-slate-800">
                        {session.traineeId || "Anonymous"}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-slate-700">
                        {session.scenario || "Standard CPR"}
                      </p>
                      {session.courseId && (
                        <p className="mt-0.5 break-all text-[10px] font-bold text-slate-400">{session.courseId}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      <span className="text-sm font-extrabold text-slate-800">{score}%</span>
                      <StatusBadge tone={scoreBadgeTone} label={getScoreLabel(score)} dot={false} />
                      <StatusBadge
                        tone={syncProps.tone}
                        label={syncProps.label}
                        dot={syncProps.tone !== "muted"}
                      />
                    </div>
                  </div>

                  <dl className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
                    <div>
                      <dt className="font-bold uppercase tracking-wider text-slate-400">Date &amp; time</dt>
                      <dd className="mt-1 text-slate-600">{formatDateTime(session.startedAt)}</dd>
                    </div>
                    <div>
                      <dt className="font-bold uppercase tracking-wider text-slate-400">Duration</dt>
                      <dd className="mt-1 font-mono text-slate-600">
                        {formatDuration(session.summary?.durationSeconds)}
                      </dd>
                    </div>
                  </dl>

                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="w-full border-slate-200/60 bg-white font-bold sm:w-auto"
                    onClick={() => onSelectSession(session.sessionId)}
                  >
                    Review details
                  </Button>
                </Card>
              );
            })}
          </div>

          <div className="hidden bg-white border border-slate-100 rounded-2xl shadow-[0_4px_16px_rgba(0,0,0,0.01)] overflow-hidden 2xl:block">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-xs select-none">
              <thead className="bg-slate-50/70">
                <tr>
                  <th scope="col" className="px-6 py-4.5 text-left font-bold text-slate-400 uppercase tracking-widest">
                    Trainee
                  </th>
                  <th scope="col" className="px-6 py-4.5 text-left font-bold text-slate-400 uppercase tracking-widest">
                    Course / Scenario
                  </th>
                  <th scope="col" className="px-6 py-4.5 text-left font-bold text-slate-400 uppercase tracking-widest">
                    Date & Time
                  </th>
                  <th scope="col" className="px-6 py-4.5 text-left font-bold text-slate-400 uppercase tracking-widest">
                    Duration
                  </th>
                  <th scope="col" className="px-6 py-4.5 text-left font-bold text-slate-400 uppercase tracking-widest">
                    Performance Score
                  </th>
                  <th scope="col" className="px-6 py-4.5 text-left font-bold text-slate-400 uppercase tracking-widest">
                    Sync Status
                  </th>
                  <th scope="col" className="relative px-6 py-4.5">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100 text-slate-600 font-medium">
                {filteredSessions.map((s) => {
                  const score = s.summary?.score ?? 0;
                  const scoreTone = getScoreTone(score);
                  const label = getScoreLabel(score);
                  const badgeTone: "success" | "info" | "warning" | "danger" | "muted" =
                    scoreTone === "excellent"
                      ? "success"
                      : scoreTone === "good"
                      ? "info"
                      : scoreTone === "fair"
                      ? "warning"
                      : "danger";

                  return (
                    <tr key={s.sessionId} className="hover:bg-slate-50/40 transition-colors duration-200">
                      <td className="px-6 py-4 whitespace-nowrap font-bold text-slate-800 font-mono">
                        {s.traineeId || "Anonymous"}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="block font-semibold text-slate-700">{s.scenario || "Standard CPR"}</span>
                        {s.courseId && <span className="block text-[10px] text-slate-400 font-bold mt-0.5">{s.courseId}</span>}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-slate-500">
                        {formatDateTime(s.startedAt)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-slate-500 font-mono">
                        {formatDuration(s.summary?.durationSeconds)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-slate-800 text-sm">{score}%</span>
                          <StatusBadge tone={badgeTone} label={label} dot={false} />
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {(() => {
                          const queueItem = syncQueue.find((item) => item.entityId === s.sessionId);
                          const syncProps = getSyncBadgeProps(queueItem?.syncStatus);
                          return (
                            <StatusBadge
                              tone={syncProps.tone}
                              label={syncProps.label}
                              dot={syncProps.tone !== "muted"}
                            />
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right font-medium">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="bg-white border-slate-200/60 font-bold"
                          onClick={() => onSelectSession(s.sessionId)}
                        >
                          Review details
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </div>
        </>
      )}
    </div>
  );
}

export default RecentSessionsPage;
