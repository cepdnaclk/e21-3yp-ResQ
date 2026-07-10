import { useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { queryInstructorCoach } from "../../api/sessionsApi";
import type { CprInstructorCoachQueryResponse } from "../../api/sessionsApi";
import type { TraineeRecord } from "../../types/trainee";
import type { CompletedSession } from "../../types/session";
import Card from "../ui/Card";
import Button from "../ui/Button";

interface InstructorAiAssistantPanelProps {
  trainees: TraineeRecord[];
  completedSessions: CompletedSession[];
}

export function InstructorAiAssistantPanel({
  trainees,
  completedSessions,
}: InstructorAiAssistantPanelProps) {
  const { currentUser } = useAuth();
  
  // State for form filters
  const [question, setQuestion] = useState("");
  const [selectedTraineeId, setSelectedTraineeId] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<CprInstructorCoachQueryResponse | null>(null);

  const isInstructorOrAdmin =
    currentUser?.role === "ADMIN" || currentUser?.role === "INSTRUCTOR";

  if (!isInstructorOrAdmin) {
    return null;
  }

  const handleSuggestedQuestionClick = (q: string) => {
    setQuestion(q);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;

    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const res = await queryInstructorCoach({
        question: question.trim(),
        traineeId: selectedTraineeId || undefined,
        sessionId: selectedSessionId || undefined,
        fromDate: fromDate ? new Date(fromDate).toISOString() : undefined,
        toDate: toDate ? new Date(toDate).toISOString() : undefined,
      });

      setResponse(res);
    } catch (err: any) {
      console.error(err);
      if (err && err.status === 403) {
        setError("You are not authorized to access instructor AI assistant.");
      } else {
        setError(err instanceof Error ? err.message : "Failed to load instructor coach response.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setQuestion("");
    setSelectedTraineeId("");
    setSelectedSessionId("");
    setFromDate("");
    setToDate("");
    setError(null);
    setResponse(null);
  };

  // If there are no sessions in history, display empty state
  const hasNoSessions = completedSessions.length === 0;

  return (
    <Card className="border border-indigo-100 bg-gradient-to-br from-indigo-50/10 to-violet-50/10 mt-8">
      {/* Header */}
      <div className="flex items-center gap-3.5 mb-5">
        <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-600 text-white font-black text-xs shadow-md shadow-indigo-200">
          Instructor AI
        </div>
        <div>
          <h3 className="text-sm font-bold text-slate-800 tracking-tight">Instructor AI Assistant</h3>
          <p className="text-xs text-slate-400">Ask training-focused questions based on completed CPR sessions.</p>
        </div>
      </div>

      {hasNoSessions ? (
        <div className="py-8 text-center bg-white/60 rounded-2xl border border-slate-100 p-6">
          <p className="text-slate-500 text-sm font-semibold">No completed CPR sessions available.</p>
          <p className="text-slate-400 text-xs mt-1">Please complete a CPR practice session first to unlock training insights.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Filters Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 bg-white/60 p-4 rounded-2xl border border-slate-100">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                Focus Trainee (Optional)
              </label>
              <select
                value={selectedTraineeId}
                onChange={(e) => setSelectedTraineeId(e.target.value)}
                className="block w-full px-3 py-2 border border-slate-200 rounded-xl text-xs text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="">All Trainees</option>
                {trainees.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.displayName} ({t.traineeCode})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                Focus Session (Optional)
              </label>
              <select
                value={selectedSessionId}
                onChange={(e) => setSelectedSessionId(e.target.value)}
                className="block w-full px-3 py-2 border border-slate-200 rounded-xl text-xs text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="">All Sessions</option>
                {completedSessions.map((s) => (
                  <option key={s.sessionId} value={s.sessionId}>
                    {s.sessionId.substring(0, 8)}... ({new Date(s.endedAt || s.startedAt).toLocaleDateString()})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                From Date
              </label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="block w-full px-3 py-1.5 border border-slate-200 rounded-xl text-xs text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                To Date
              </label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="block w-full px-3 py-1.5 border border-slate-200 rounded-xl text-xs text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
          </div>

          {/* Suggested Questions */}
          <div className="space-y-1.5">
            <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Suggested Questions</span>
            <div className="flex flex-wrap gap-2">
              {[
                "Which trainees need attention today?",
                "What are the most common mistakes?",
                "Summarize this trainee's last session.",
                "Compare this trainee's recent sessions.",
                "What feedback should I give this trainee?",
              ].map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => handleSuggestedQuestionClick(q)}
                  className="text-[11px] font-bold text-indigo-600 bg-indigo-50/60 hover:bg-indigo-100/80 px-3 py-1.5 rounded-full transition-all border border-indigo-100/40 text-left active:scale-[0.98]"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* Query Form */}
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="text"
              placeholder="Ask training-focused questions (e.g. Which trainees need attention today?)"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={loading}
              className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all placeholder-slate-400 text-slate-800"
            />
            <Button
              type="submit"
              disabled={loading || !question.trim()}
              className="font-bold bg-indigo-600 hover:bg-indigo-700 text-white px-5 rounded-xl shrink-0"
            >
              {loading ? "Analyzing..." : "Ask Assistant"}
            </Button>
            {(question || response || error) && (
              <Button
                type="button"
                variant="secondary"
                onClick={handleClear}
                className="font-bold border border-slate-200 bg-white"
              >
                Clear
              </Button>
            )}
          </form>

          {/* States */}
          {loading && (
            <div className="py-12 text-center text-xs text-indigo-500 animate-pulse font-medium bg-white/40 rounded-2xl border border-slate-100/50">
              Generating local training insights and reviewing classroom metrics...
            </div>
          )}

          {error && (
            <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl text-xs text-rose-700 font-semibold leading-relaxed">
              {error}
            </div>
          )}

          {/* Results Response Panel */}
          {response && !loading && (
            <div className="space-y-5 bg-white/80 backdrop-blur-sm border border-slate-100 rounded-2xl p-5 shadow-sm">
              
              {/* Main Answer */}
              <div className="space-y-1.5">
                <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Analysis Answer</h4>
                <div className="text-sm text-slate-700 leading-relaxed font-medium bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <p className="whitespace-pre-line">{response.answer}</p>
                </div>
              </div>

              {/* Priority Trainees needing attention */}
              {response.priorityTrainees && response.priorityTrainees.length > 0 && (
                <div className="space-y-2 border-t border-slate-100/60 pt-4">
                  <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-rose-500">Trainees Needing Attention</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {response.priorityTrainees.map((pt, idx) => (
                      <div key={idx} className="p-3.5 bg-rose-50/30 border border-rose-100/60 rounded-xl space-y-1">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-bold text-slate-800">{pt.name}</span>
                          <span className="text-[10px] font-extrabold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-100">
                            Last Score: {pt.lastSessionScore}%
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 font-semibold">Trainee ID: {pt.traineeId}</p>
                        <p className="text-[11px] text-slate-600 font-medium leading-relaxed mt-1">
                          <span className="font-bold text-rose-500">Issue:</span> {pt.reasonForAttention}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Common Issues / Mistakes list */}
              {response.commonIssues && response.commonIssues.length > 0 && (
                <div className="space-y-2 border-t border-slate-100/60 pt-4">
                  <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Widespread Mistakes</h4>
                  <div className="flex flex-wrap gap-2">
                    {response.commonIssues.map((issue, idx) => (
                      <span
                        key={idx}
                        className="text-[11px] font-medium text-slate-600 bg-slate-50 px-3 py-1 rounded-xl border border-slate-200/60"
                      >
                        {issue}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Suggested Actions */}
              {response.suggestedInstructorActions && response.suggestedInstructorActions.length > 0 && (
                <div className="space-y-2 border-t border-slate-100/60 pt-4">
                  <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-600">Suggested Instructor Actions</h4>
                  <ul className="space-y-2">
                    {response.suggestedInstructorActions.map((action, idx) => (
                      <li key={idx} className="text-xs text-slate-600 flex items-start gap-2.5 font-medium bg-emerald-50/20 px-3.5 py-2.5 rounded-xl border border-emerald-100/60">
                        <span className="text-emerald-500 font-bold shrink-0 mt-0.5">✓</span>
                        <span>{action}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Related Session IDs */}
              {response.relatedSessionIds && response.relatedSessionIds.length > 0 && (
                <div className="space-y-2 border-t border-slate-100/60 pt-4">
                  <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Related Sessions</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {response.relatedSessionIds.map((id, idx) => (
                      <span
                        key={idx}
                        className="text-[10px] font-mono font-bold text-slate-500 bg-slate-100/80 px-2 py-0.5 rounded-md"
                      >
                        {id.substring(0, 8)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

            </div>
          )}

          {/* Empty response boundary */}
          {response && !loading && response.answer === "" && (
            <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl text-xs text-amber-700 font-semibold">
              No completed CPR sessions found for the selected range.
            </div>
          )}

        </div>
      )}
    </Card>
  );
}
