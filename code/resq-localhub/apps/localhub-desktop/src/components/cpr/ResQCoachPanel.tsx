import { useState } from "react";
import { queryCoach, type CprCoachQueryResponse } from "../../api/cprCoachApi";
import Card from "../ui/Card";
import Button from "../ui/Button";

interface ResQCoachPanelProps {
  targetUserId: string;
}

export function ResQCoachPanel({ targetUserId }: ResQCoachPanelProps) {
  const [question, setQuestion] = useState("");
  const [coachResponse, setCoachResponse] = useState<CprCoachQueryResponse | null>(null);
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachError, setCoachError] = useState<string | null>(null);

  const handleAskSuggested = async (q: string) => {
    setQuestion(q);
    await executeQuery(q);
  };

  const handleAskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    await executeQuery(question.trim());
  };

  const executeQuery = async (queryText: string) => {
    setCoachLoading(true);
    setCoachError(null);
    try {
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

  return (
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
  );
}
