import { useEffect, useState } from "react";
import { fetchCompletedSession } from "../../api/sessionsApi";
import { downloadSessionJson, downloadSessionCsv } from "../../api/exportsApi";
import type { CompletedSession } from "../../types/session";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";
import PageHeader from "../../components/ui/PageHeader";
import { CompressionQualitySummary } from "../../components/cpr/CompressionQualitySummary";
import { ResQCoachPanel } from "../../components/cpr/ResQCoachPanel";
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

  if (loading) {
    return <LoadingState message="Loading training session review..." />;
  }

  if (error || !session) {
    return (
      <div className="space-y-6">
        <PageHeader title="Session Review" onBack={onBack} />
        <Card className="p-8 text-center space-y-4 border-rose-100 bg-rose-50/50">
          <p className="text-sm font-semibold text-rose-700">{error || "Session details could not be found."}</p>
          <div>
            <Button onClick={onBack} variant="outline" size="sm">
              Back to Recent Sessions
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const summary = session.summary;
  const overallScore = summary.overallScore ?? summary.score;
  const improvementArea =
    summary.avgDepthMm < 50
      ? "Depth was shallow during compressions. Aim for 50-60 mm."
      : summary.avgDepthMm > 60
      ? "Depth was deeper than necessary. Keep within 50-60 mm."
      : summary.avgRateCpm < 100
      ? "Cadence was slow. Maintain a tempo of 100-120 cpm."
      : summary.avgRateCpm > 120
      ? "Cadence was fast. Steady your pace between 100-120 cpm."
      : summary.recoilPct < 85
      ? "Chest release was incomplete. Allow full expansion between compressions."
      : "Great work! Solid consistency across depth, rate, and release.";

  const targetUserId = session.traineeId || currentUser?.id || currentUser?.username || "unknown";

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-12">
      <PageHeader
        title={`Session Review: ${session.sessionId}`}
        description={`Completed on ${new Date(session.endedAt).toLocaleDateString()} at ${new Date(session.endedAt).toLocaleTimeString()}`}
        onBack={onBack}
        actions={
          <div className="flex gap-2">
            <Button
              onClick={() => downloadSessionCsv(session.sessionId)}
              variant="outline"
              size="sm"
              className="font-bold border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              Export CSV
            </Button>
            <Button
              onClick={() => downloadSessionJson(session.sessionId)}
              variant="outline"
              size="sm"
              className="font-bold border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              Export JSON
            </Button>
          </div>
        }
      />

      {/* Main Review Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Score & Core Telemetry Summary */}
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="text-center py-6 border-indigo-100 bg-gradient-to-br from-indigo-50/20 to-white">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 block mb-1">Overall Score</span>
              <span className="text-4xl font-black text-indigo-600 tracking-tight">{overallScore}%</span>
            </Card>
            <Card className="text-center py-6">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 block mb-1">Duration</span>
              <span className="text-3xl font-extrabold text-slate-800 tracking-tight">{summary.durationSeconds}s</span>
            </Card>
            <Card className="text-center py-6">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 block mb-1">Total Compressions</span>
              <span className="text-3xl font-extrabold text-slate-800 tracking-tight">{summary.totalCompressions}</span>
            </Card>
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
      <ResQCoachPanel targetUserId={targetUserId} />
    </div>
  );
}

export default SessionReviewPage;
