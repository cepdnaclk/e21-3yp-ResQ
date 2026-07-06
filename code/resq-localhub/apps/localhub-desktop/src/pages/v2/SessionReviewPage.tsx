import { useEffect, useState } from "react";
import { fetchCompletedSession, queryCoach } from "../../api/sessionsApi";
import type { CprCoachQueryResponse } from "../../api/sessionsApi";
import { downloadSessionJson, downloadSessionCsv } from "../../api/exportsApi";
import type { CompletedSession } from "../../types/session";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";
import PageHeader from "../../components/ui/PageHeader";
import { CompressionQualitySummary } from "../../components/cpr/CompressionQualitySummary";
import { useAuth } from "../../auth/AuthContext";

type SessionReviewPageProps = {
  sessionId: string;
  onBack: () => void;
};

export function SessionReviewPage({ sessionId, onBack }: SessionReviewPageProps) {
  const { currentUser } = useAuth();
  const [session, setSession] = useState<CompletedSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [question, setQuestion] = useState("");
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachError, setCoachError] = useState<string | null>(null);
  const [coachResponse, setCoachResponse] = useState<CprCoachQueryResponse | null>(null);

  useEffect(() => {
    async function loadSession() {
      try {
        const data = await fetchCompletedSession(sessionId);
        setSession(data);
      } catch (err) {
        setError("Failed to load session details.");
      } finally {
        setLoading(false);
      }
    }
    loadSession();
  }, [sessionId]);

  const handleAskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    await executeQuery(question.trim());
  };

  const handleAskSuggested = async (q: string) => {
    setQuestion(q);
    await executeQuery(q);
  };

  const executeQuery = async (queryText: string) => {
    if (!session) return;
    setCoachLoading(true);
    setCoachError(null);
    try {
      const targetUserId = session.traineeId || currentUser?.id || currentUser?.username || "unknown";
      const res = await queryCoach({
        userId: targetUserId,
        question: queryText
      });
      setCoachResponse(res);
    } catch (err) {
      setCoachError(err instanceof Error ? err.message : "Failed to generate coach response.");
    } finally {
      setCoachLoading(false);
    }
  };

  if (loading) {
    return <LoadingState message="Loading training session review..." />;
  }

  if (error || !session) {
    return (
      <Card className="text-center max-w-lg mx-auto py-16 mt-8">
        <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400 font-bold mb-4">
          !
        </div>
        <h3 className="text-lg font-bold text-slate-800">Review Unavailable</h3>
        <p className="text-sm text-slate-400 mt-1 max-w-xs mx-auto leading-relaxed">{error || "Unable to load session."}</p>
        <Button type="button" className="mt-6 font-bold" onClick={onBack}>
          Back to History
        </Button>
      </Card>
    );
  }

  // Derive simple suggestions/improvement areas based on metrics
  const summary = session.summary;
  let improvementArea = "Excellent performance! Maintain consistent rhythm and chest recoil.";
  if (summary.avgDepthMm && summary.avgDepthMm < 45) {
    improvementArea = "Focus on compressing deeper to reach the target range of 50-60 mm.";
  } else if (summary.avgDepthMm && summary.avgDepthMm > 65) {
    improvementArea = "Reduce compression depth slightly to avoid excessive pressure.";
  } else if (summary.avgRateCpm && summary.avgRateCpm < 100) {
    improvementArea = "Speed up compressions slightly to maintain a steady rhythm of 100-120 compressions per minute.";
  } else if (summary.avgRateCpm && summary.avgRateCpm > 125) {
    improvementArea = "Slow down compressions slightly. Keep within the recommended rate of 100-120 per minute.";
  } else if (summary.recoilPct && summary.recoilPct < 85) {
    improvementArea = "Ensure you fully release the chest between compressions to allow correct heart refilling.";
  } else if (summary.pausesCount > 2) {
    improvementArea = "Minimize interruptions or pauses during CPR cycles.";
  }

  const score = summary.score ?? 0;
  const isExcellent = score >= 85;
  const isGood = score >= 70 && score < 85;
  const isWarning = score >= 50 && score < 70;

  const scoreBgColor = isExcellent 
    ? "bg-emerald-50 text-emerald-800 border-emerald-100 shadow-emerald-500/5" 
    : isGood 
    ? "bg-blue-50 text-blue-800 border-blue-100 shadow-blue-500/5" 
    : isWarning 
    ? "bg-amber-50 text-amber-800 border-amber-100 shadow-amber-500/5" 
    : "bg-rose-50 text-rose-800 border-rose-100 shadow-rose-500/5";

  const scoreTextColor = isExcellent 
    ? "text-emerald-600" 
    : isGood 
    ? "text-blue-600" 
    : isWarning 
    ? "text-amber-600" 
    : "text-rose-600";

  const isInstructorOrAdmin = currentUser?.role === "ADMIN" || currentUser?.role === "INSTRUCTOR";

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Page Header with Reports downloads */}
      <PageHeader
        title="Training Session Review"
        subtitle={`CPR logs review for trainee: ${session.traineeId || "Anonymous"}`}
        back={{ label: "Back to History", onClick: onBack }}
        actions={
          isInstructorOrAdmin ? (
            <div className="flex gap-2.5">
              <Button
                type="button"
                variant="secondary"
                onClick={() => downloadSessionCsv(sessionId)}
                className="font-bold border border-slate-200/80 bg-white"
              >
                Export CSV Session Report
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => downloadSessionJson(sessionId)}
                className="font-bold border border-slate-200/80 bg-white"
              >
                Export JSON Session Report
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Quality Summary Grid */}
        <div className="md:col-span-2 space-y-6">
          {/* Performance Hero card */}
          <div className={`p-6 border rounded-2xl flex flex-col sm:flex-row items-center gap-6 shadow-sm ${scoreBgColor}`}>
            <div className="w-24 h-24 rounded-full border-4 border-current flex flex-col items-center justify-center bg-white shadow-inner shrink-0">
              <span className={`text-3xl font-black ${scoreTextColor}`}>{score}%</span>
              <span className="text-[9px] font-extrabold uppercase text-slate-400">Score</span>
            </div>
            <div className="space-y-1 text-center sm:text-left">
              <h3 className="text-lg font-bold tracking-tight">Performance Rating</h3>
              <p className="text-xs leading-relaxed opacity-90 font-medium">
                {score >= 85 
                  ? "Outstanding CPR execution. Compression parameters match target clinical guidelines." 
                  : score >= 70 
                  ? "Adequate performance with minor discrepancies in metrics limits. Ready for classroom practice." 
                  : "Attention needed. Review recommendations and practice chest recoil and compression rate."}
              </p>
            </div>
          </div>

          <Card>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-5">Performance Metrics</h3>
            <CompressionQualitySummary summary={summary} />
          </Card>
        </div>

        {/* Actionable Insights */}
        <div className="space-y-6">
          <Card className="border-blue-100 bg-blue-50/50">
            <h3 className="text-xs font-bold text-blue-900 uppercase tracking-wider mb-2.5">Key Improvement Area</h3>
            <p className="text-sm text-blue-800 leading-relaxed font-semibold">{improvementArea}</p>
          </Card>

          <Card>
            <h3 className="text-xs font-bold text-slate-400 border-b border-slate-100 pb-3 mb-4 uppercase tracking-wider">Session Info</h3>
            <div className="space-y-3.5 text-xs text-slate-500">
              <div className="flex justify-between items-center bg-slate-50 p-2.5 rounded-xl border border-slate-100/40">
                <span className="font-semibold">Start Time:</span>
                <span className="font-bold text-slate-800">{new Date(session.startedAt).toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center bg-slate-50 p-2.5 rounded-xl border border-slate-100/40">
                <span className="font-semibold">End Time:</span>
                <span className="font-bold text-slate-800">{new Date(session.endedAt).toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center bg-slate-50 p-2.5 rounded-xl border border-slate-100/40">
                <span className="font-semibold">Scenario:</span>
                <span className="font-bold text-slate-800">{session.scenario || "Standard CPR"}</span>
              </div>
              {session.notes && (
                <div className="border-t border-slate-100 pt-3.5 mt-2">
                  <span className="font-bold text-slate-400 block mb-1 text-[10px] uppercase tracking-wider">Instructor Notes</span>
                  <p className="text-slate-600 font-sans italic bg-slate-50 p-3 rounded-xl border border-slate-100/40 leading-relaxed">{session.notes}</p>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Ask ResQ Coach Section */}
      <Card className="border border-indigo-100 bg-gradient-to-br from-indigo-50/10 to-violet-50/10">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-xl bg-indigo-500 text-white font-black text-sm shadow-indigo-500/10">
            AI
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800 tracking-tight">Ask ResQ Coach</h3>
            <p className="text-xs text-slate-400">Get personalized, clinical CPR training recommendations based on your performance history.</p>
          </div>
        </div>

        {/* Suggested Questions */}
        <div className="flex flex-wrap gap-2 mb-4">
          {[
            "List my bad performances in the last 3 weeks",
            "What mistakes do I repeat most?",
            "Am I improving?",
            "Compare my last session with my best session",
            "What should I practice next?"
          ].map((q) => (
            <button
              key={q}
              onClick={() => handleAskSuggested(q)}
              className="text-[11px] font-bold text-indigo-600 bg-indigo-50/60 hover:bg-indigo-100/80 px-3 py-1.5 rounded-full transition-colors border border-indigo-100/40 text-left"
            >
              {q}
            </button>
          ))}
        </div>

        {/* Question Input Form */}
        <form onSubmit={handleAskSubmit} className="flex gap-2 mb-5">
          <input
            type="text"
            placeholder="Type your question (e.g. What should I practice next?)"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={coachLoading}
            className="flex-1 bg-white border border-slate-200/80 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all placeholder-slate-400"
          />
          <Button
            type="submit"
            disabled={coachLoading || !question.trim()}
            className="font-bold bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {coachLoading ? "Analyzing..." : "Ask Coach"}
          </Button>
        </form>

        {/* Loading / Error States */}
        {coachLoading && (
          <div className="py-8 text-center text-xs text-indigo-500 animate-pulse font-medium">
            Generating local clinical insights and reviewing training logs...
          </div>
        )}

        {coachError && (
          <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl text-xs text-rose-700 font-semibold mb-4 leading-relaxed">
            {coachError}
          </div>
        )}

        {/* Response Area */}
        {coachResponse && !coachLoading && (
          <div className="space-y-4 bg-white/70 backdrop-blur-sm border border-slate-100 rounded-xl p-5 shadow-sm">
            {/* Answer text */}
            <div className="space-y-1">
              <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">Response</h4>
              <p className="text-sm text-slate-700 leading-relaxed font-medium bg-slate-50/50 p-3.5 rounded-xl border border-slate-100/60">{coachResponse.answer}</p>
            </div>

            {/* Trend Direction tag */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">Trend Direction:</span>
              <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full border ${
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              {/* Main Issues */}
              {coachResponse.mainIssues.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">Main Issues</h4>
                  <ul className="space-y-1.5">
                    {coachResponse.mainIssues.map((issue, idx) => (
                      <li key={idx} className="text-xs text-slate-600 flex items-center gap-2 font-medium bg-slate-50/50 px-3 py-2 rounded-lg border border-slate-100/60">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0"></span>
                        {issue}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Recommendations */}
              {coachResponse.recommendations.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">Actionable Recommendations</h4>
                  <ul className="space-y-1.5">
                    {coachResponse.recommendations.map((rec, idx) => (
                      <li key={idx} className="text-xs text-slate-600 flex items-center gap-2 font-medium bg-slate-50/50 px-3 py-2 rounded-lg border border-slate-100/60">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></span>
                        {rec}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Bad Sessions */}
            {coachResponse.badSessions.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-100/60">
                <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">Flagged Sub-Optimal Sessions</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {coachResponse.badSessions.map((bs, idx) => (
                    <div key={idx} className="p-3 bg-slate-50/50 border border-slate-100 rounded-xl space-y-1">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-bold text-slate-700">{bs.shortReason}</span>
                        <span className="text-[10px] font-extrabold text-rose-500 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-100/60">Score: {bs.overallScore}%</span>
                      </div>
                      <p className="text-[10px] text-slate-400 font-semibold">{new Date(bs.sessionDateTime).toLocaleString()}</p>
                      <p className="text-[11px] text-slate-500 font-medium italic mt-0.5">Recommendation: {bs.recommendation}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

export default SessionReviewPage;
