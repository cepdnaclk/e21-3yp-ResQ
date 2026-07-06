import { useEffect, useState, useMemo } from "react";
import { fetchCompletedSessions, fetchSyncQueue, queryCoach } from "../../api/sessionsApi";
import type { CprCoachQueryResponse } from "../../api/sessionsApi";
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

function getSyncBadgeProps(
  status:
    | "PENDING"
    | "SYNCING"
    | "SYNCED"
    | "FAILED"
    | "RETRY_LATER"
    | "SKIPPED"
    | undefined,
) {
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
      return {
        label: "Retry later",
        tone: "warning" as const,
      };

    case "FAILED":
      return {
        label: "Sync failed",
        tone: "danger" as const,
      };

    case "SKIPPED":
      return {
        label: "Skipped",
        tone: "muted" as const,
      };

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

  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachError, setCoachError] = useState<string | null>(null);
  const [coachResponse, setCoachResponse] = useState<CprCoachQueryResponse | null>(null);

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

  const handleSelectRow = (sessionId: string) => {
    setSelectedSessionIds(prev => 
      prev.includes(sessionId) 
        ? prev.filter(id => id !== sessionId) 
        : [...prev, sessionId]
    );
  };

  const handleSelectAll = () => {
    if (selectedSessionIds.length === filteredSessions.length) {
      setSelectedSessionIds([]);
    } else {
      setSelectedSessionIds(filteredSessions.map(s => s.sessionId));
    }
  };

  const handleAnalyzeWithCoach = async () => {
    if (selectedSessionIds.length === 0) return;
    
    setCoachLoading(true);
    setCoachError(null);
    setCoachResponse(null);

    try {
      const selected = sessions.filter(s => selectedSessionIds.includes(s.sessionId));
      const traineeId = selected[0]?.traineeId || "unknown";
      
      const questionText = selectedSessionIds.length === 1 
        ? "Explain this session" 
        : "Analyze my progress";

      let minDate: string | undefined = undefined;
      let maxDate: string | undefined = undefined;
      
      selected.forEach(s => {
        if (!minDate || s.startedAt < minDate) minDate = s.startedAt;
        if (!maxDate || s.startedAt > maxDate) maxDate = s.startedAt;
      });

      const res = await queryCoach({
        userId: traineeId,
        question: questionText,
        fromDate: minDate,
        toDate: maxDate
      });

      setCoachResponse(res);
    } catch (err) {
      setCoachError(err instanceof Error ? err.message : "Failed to run AI Coach analysis.");
    } finally {
      setCoachLoading(false);
    }
  };

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
    <div className="space-y-8 max-w-6xl mx-auto">
      <PageHeader
        title="Session History"
        subtitle="Review past CPR training performance records and export report logs."
      />

      {/* Selected Action Banner */}
      {selectedSessionIds.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-indigo-50 border border-indigo-100/80 p-4 rounded-2xl shadow-[0_4px_16px_rgba(79,70,229,0.05)] animate-fadeIn">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-indigo-500 flex items-center justify-center text-white font-black text-xs shadow-indigo-500/20">
              AI
            </div>
            <div>
              <p className="text-xs font-bold text-slate-800">{selectedSessionIds.length} CPR Session(s) Selected</p>
              <p className="text-[10px] text-slate-500 font-semibold">
                {selectedSessionIds.length === 1 ? '“Explain this session”' : '“Analyze my progress”'} with ResQ Coach.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={coachLoading}
              onClick={handleAnalyzeWithCoach}
              className="font-bold bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-4 py-2"
            >
              {coachLoading ? "Analyzing..." : "Analyze with ResQ Coach"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setSelectedSessionIds([])}
              className="font-bold bg-white text-xs border-slate-200/60 px-4 py-2"
            >
              Clear Selection
            </Button>
          </div>
        </div>
      )}

      {/* Coach Analysis Result Display */}
      {coachLoading && (
        <Card className="border border-indigo-100 bg-indigo-50/10 py-12 text-center">
          <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin mx-auto mb-3"></div>
          <p className="text-xs text-indigo-500 font-bold tracking-tight">Generating ResQ Coach analysis...</p>
        </Card>
      )}

      {coachError && (
        <Card className="border border-rose-100 bg-rose-50/50 p-4 text-rose-800 text-xs font-semibold max-w-lg mx-auto text-center leading-relaxed">
          {coachError}
        </Card>
      )}

      {coachResponse && !coachLoading && (
        <Card className="border border-indigo-100 bg-gradient-to-br from-indigo-50/10 to-violet-50/10 p-6 space-y-4 animate-fadeIn">
          <div className="flex items-center justify-between border-b border-indigo-100/50 pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-indigo-500 text-white font-black text-xs shadow-indigo-500/10">
                COACH
              </div>
              <div>
                <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider">AI Coach Analysis Result</h3>
                <p className="text-[10px] text-slate-400 font-semibold">Personalized CPR history clinical insights.</p>
              </div>
            </div>
            <button
              onClick={() => setCoachResponse(null)}
              className="text-xs font-bold text-slate-400 hover:text-slate-600"
            >
              Dismiss
            </button>
          </div>

          <div className="space-y-1">
            <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Analysis Summary</h4>
            <p className="text-sm text-slate-700 leading-relaxed font-semibold bg-white p-3.5 rounded-xl border border-slate-100/80 shadow-sm">{coachResponse.answer}</p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Trend Direction:</span>
            <span className={`text-[9px] font-extrabold uppercase px-2.5 py-0.5 rounded-full border ${
              coachResponse.trendDirection === "IMPROVING" 
                ? "bg-emerald-50 text-emerald-700 border-emerald-100" 
                : coachResponse.trendDirection === "DECLINING"
                ? "bg-rose-50 text-rose-700 border-rose-100"
                : coachResponse.trendDirection === "STABLE"
                ? "bg-blue-50 text-blue-700 border-blue-100"
                : "bg-slate-50 text-slate-500 border-slate-100"
            }`}>
              {coachResponse.trendDirection}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {coachResponse.mainIssues.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Main Issues</h4>
                <ul className="space-y-1.5">
                  {coachResponse.mainIssues.map((issue, idx) => (
                    <li key={idx} className="text-xs text-slate-600 flex items-center gap-2 font-medium bg-white px-3 py-2 rounded-lg border border-slate-100/60 shadow-[0_2px_4px_rgba(0,0,0,0.01)]">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0"></span>
                      {issue}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {coachResponse.recommendations.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Actionable Recommendations</h4>
                <ul className="space-y-1.5">
                  {coachResponse.recommendations.map((rec, idx) => (
                    <li key={idx} className="text-xs text-slate-600 flex items-center gap-2 font-medium bg-white px-3 py-2 rounded-lg border border-slate-100/60 shadow-[0_2px_4px_rgba(0,0,0,0.01)]">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></span>
                      {rec}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>
      )}

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
        <div className="bg-white border border-slate-100 rounded-2xl shadow-[0_4px_16px_rgba(0,0,0,0.01)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-xs select-none">
              <thead className="bg-slate-50/70">
                <tr>
                  <th scope="col" className="px-6 py-4.5 text-left font-bold text-slate-400 uppercase tracking-widest w-12">
                    <input
                      type="checkbox"
                      checked={selectedSessionIds.length === filteredSessions.length && filteredSessions.length > 0}
                      onChange={handleSelectAll}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/20 w-4 h-4 cursor-pointer"
                    />
                  </th>
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
                      <td className="px-6 py-4 whitespace-nowrap w-12">
                        <input
                          type="checkbox"
                          checked={selectedSessionIds.includes(s.sessionId)}
                          onChange={() => handleSelectRow(s.sessionId)}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/20 w-4 h-4 cursor-pointer"
                        />
                      </td>
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
      )}
    </div>
  );
}

export default RecentSessionsPage;
