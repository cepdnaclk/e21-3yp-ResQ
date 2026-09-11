import { useEffect, useState } from "react";
import { fetchAuthoritativeCompletedSession } from "../../api/sessionsApi";
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

  useEffect(() => {
    const controller = new AbortController();
    async function loadSession() {
      try {
        const data = await fetchAuthoritativeCompletedSession(sessionId, { signal: controller.signal });
        setSession(data);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Failed to load session details.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadSession();
    return () => controller.abort();
  }, [sessionId]);

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

  const summary = session.summary;
  let improvementArea = summary.recommendation ?? "Excellent performance! Maintain consistent rhythm and chest recoil.";
  if (!summary.recommendation && summary.avgDepthMm && summary.avgDepthMm < 45) {
    improvementArea = "Focus on compressing deeper to reach the target range of 50-60 mm.";
  } else if (!summary.recommendation && summary.avgDepthMm && summary.avgDepthMm > 65) {
    improvementArea = "Reduce compression depth slightly to avoid excessive pressure.";
  } else if (!summary.recommendation && summary.avgRateCpm && summary.avgRateCpm < 100) {
    improvementArea = "Speed up compressions slightly to maintain a steady rhythm of 100-120 compressions per minute.";
  } else if (!summary.recommendation && summary.avgRateCpm && summary.avgRateCpm > 125) {
    improvementArea = "Slow down compressions slightly. Keep within the recommended rate of 100-120 per minute.";
  } else if (!summary.recommendation && summary.recoilPct && summary.recoilPct < 85) {
    improvementArea = "Ensure you fully release the chest between compressions to allow correct heart refilling.";
  } else if (!summary.recommendation && summary.pausesCount > 2) {
    improvementArea = "Minimize interruptions or pauses during CPR cycles.";
  }

  const score = summary.overallScore ?? summary.score ?? 0;
  const scoreAvailable = summary.overallScore !== null && summary.overallScore !== undefined;
  const unavailableReason = !scoreAvailable
    ? summary.scoreCapReason ?? summary.recommendation ?? "Required scoring evidence is unavailable."
    : null;
  const isExcellent = score >= 90;
  const isGood = score >= 75 && score < 90;
  const isWarning = score >= 60 && score < 75;

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
    <div className="app-page app-page--medium space-y-6">
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
              <span className={`text-3xl font-black ${scoreTextColor}`}>{scoreAvailable ? `${score}%` : "—"}</span>
              <span className="text-[9px] font-extrabold uppercase text-slate-400">Score</span>
            </div>
            <div className="space-y-1 text-center sm:text-left">
              <h3 className="text-lg font-bold tracking-tight">
                {summary.grade ?? "Performance Rating"}
                {summary.scoreProvisional ? " · Provisional" : ""}
              </h3>
              <p className="text-xs leading-relaxed opacity-90 font-medium">
                {!scoreAvailable
                  ? `Score unavailable: ${unavailableReason}`
                  : score >= 90
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
          {summary.scoringVersion && summary.scoringVersion !== "legacy-v0" && (
            <Card>
              <div className="flex items-center justify-between gap-3 mb-4">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Score breakdown</h3>
                <span className="text-[10px] font-bold text-slate-500">{summary.scoringVersion}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                {[
                  ["Depth", summary.depthScore, summary.avgDepthMm == null ? "—" : `${summary.avgDepthMm.toFixed(1)} mm`, summary.depthTarget],
                  ["Rate", summary.rateScore, summary.avgRateCpm == null ? "—" : `${summary.avgRateCpm.toFixed(0)} cpm`, summary.rateTarget],
                  ["Recoil", summary.recoilScore, summary.recoilPct == null ? "—" : `${summary.recoilPct.toFixed(0)}%`, summary.recoilTarget],
                  ["Hand placement", summary.handPlacementScore, summary.handPlacementPct == null ? "—" : `${summary.handPlacementPct.toFixed(0)}%`, summary.handPlacementTarget],
                  ["Compression fraction", summary.compressionFractionScore, summary.compressionFractionPct == null ? "—" : `${summary.compressionFractionPct.toFixed(0)}%`, summary.compressionFractionTarget],
                ].map(([label, componentScore, raw, target]) => (
                  <div key={String(label)} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <div className="flex justify-between font-bold text-slate-800"><span>{label}</span><span>{componentScore == null ? "—" : `${componentScore}/100`}</span></div>
                    <div className="mt-1 flex justify-between text-slate-500"><span>{raw}</span><span>Target: {target ?? "—"}</span></div>
                  </div>
                ))}
              </div>
              {scoreAvailable && summary.scoreCapReason && (
                <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
                  Score capped at {summary.scoreCap}: {summary.scoreCapReason}
                </p>
              )}
              {!scoreAvailable && (
                <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">
                  Score unavailable: {unavailableReason}
                </p>
              )}
              {summary.scoreProvisional && (
                <p className="mt-3 text-xs font-semibold text-slate-600">
                  Provisional: {summary.scoreValidCompressionCount ?? 0} valid compressions; more evidence is required for a final result.
                </p>
              )}
            </Card>
          )}
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
    </div>
  );
}

export default SessionReviewPage;
