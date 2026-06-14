import { useEffect, useState } from "react";
import { fetchSessionLive, endSession } from "../../api/sessionsApi";
import { subscribeToSessionLive } from "../../api/liveEventsClient";
import type { SessionLiveView } from "../../types/live";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";
import { MetricCard } from "../../components/cpr/MetricCard";
import { CoachingCue } from "../../components/cpr/CoachingCue";
import { SessionTimer } from "../../components/cpr/SessionTimer";
import {
  formatDepth,
  formatRate,
  formatRecoilPct,
  getCompressionCue,
} from "../../utils/userFriendlyLabels";

type InstructorLiveSessionPageProps = {
  sessionId: string;
  onSessionEnded: (sessionId: string) => void;
};

export function InstructorLiveSessionPage({
  sessionId,
  onSessionEnded,
}: InstructorLiveSessionPageProps) {
  const [session, setSession] = useState<SessionLiveView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    let subscription: { stop: () => void } | null = null;
    let stopped = false;

    async function init() {
      try {
        const initial = await fetchSessionLive(sessionId);
        if (stopped) return;
        if (!initial) {
          setError("The requested live session was not found or has already ended.");
          setLoading(false);
          return;
        }

        setSession(initial);
        setLoading(false);

        // Start SSE subscription
        subscription = subscribeToSessionLive(
          sessionId,
          initial.deviceId,
          (update) => {
            if (!stopped) setSession(update);
          },
          () => {
            if (!stopped) onSessionEnded(sessionId);
          },
          (err) => {
            console.warn("SSE connection error", err);
          }
        );
      } catch (err) {
        if (!stopped) {
          setError("Failed to connect to the live session stream.");
          setLoading(false);
        }
      }
    }

    init();

    return () => {
      stopped = true;
      subscription?.stop();
    };
  }, [sessionId]);

  async function handleEndSession() {
    setEnding(true);
    try {
      await endSession({ sessionId });
      onSessionEnded(sessionId);
    } catch (err) {
      alert("Failed to end the session. Please try again.");
      setEnding(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-8 text-white">
        <LoadingState message="Connecting to live telemetry cockpit..." />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-8 text-white">
        <div className="w-full max-w-lg bg-slate-900 border border-slate-800 text-center py-16 px-8 rounded-3xl space-y-4">
          <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mx-auto text-slate-400 font-bold">
            !
          </div>
          <h3 className="text-lg font-bold">Session Unavailable</h3>
          <p className="text-sm text-slate-400 max-w-xs mx-auto leading-relaxed">{error || "Unable to load session."}</p>
          <Button type="button" className="mt-6 font-bold" onClick={() => onSessionEnded(sessionId)}>
            Return to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  // Clinical Coaching Cue
  const coachingCue = getCompressionCue(
    session.latestMetric,
    session.latestFlags,
    session.connectionState,
    session.active
  );

  // Formatting helper values for UI cards
  const depthVal = formatDepth(session.latestDepthMm);
  const rateVal = formatRate(session.latestRateCpm);

  const recoilOkCount = session.latestMetric?.recoilOkCount || 0;
  const incompleteRecoilCount = session.latestMetric?.incompleteRecoilCount || 0;
  const recoilTotal = recoilOkCount + incompleteRecoilCount;
  const derivedRecoilPct = recoilTotal > 0 ? (recoilOkCount / recoilTotal) * 100 : null;
  const recoilVal = formatRecoilPct(derivedRecoilPct);

  // Simple assessment of tone for each metric
  const depthTone = !session.latestDepthMm ? "neutral" : session.latestDepthMm >= 45 && session.latestDepthMm <= 55 ? "good" : "warning";
  const rateTone = !session.latestRateCpm ? "neutral" : session.latestRateCpm >= 100 && session.latestRateCpm <= 120 ? "good" : "warning";
  const recoilTone = derivedRecoilPct === null ? "neutral" : derivedRecoilPct >= 90 ? "good" : "warning";
  const placementTone = session.pressureSkewed ? "danger" : session.pressureBalancePct !== null ? "good" : "neutral";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none p-6 sm:p-8">
      {/* Live Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-900 pb-5 mb-8">
        <div className="space-y-1">
          <span className="text-[10px] font-extrabold bg-rose-500/10 text-rose-500 border border-rose-500/20 px-3 py-1 rounded-full uppercase tracking-wider inline-block">
            ● Live Training
          </span>
          <h1 className="text-2xl font-black tracking-tight text-white leading-none mt-1">
            Clinical Telemetry Console
          </h1>
          <p className="text-xs text-slate-500 font-semibold leading-relaxed">
            Supervising device sensor stream: {session.deviceId}
          </p>
        </div>
        <div>
          <Button
            type="button"
            variant="danger"
            loading={ending}
            onClick={handleEndSession}
            className="shadow-md shadow-rose-500/10 font-bold px-6 py-3 text-sm rounded-xl"
          >
            End Training Session
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Side: Session details & coaching cues */}
        <div className="lg:col-span-2 space-y-8">
          {/* Clinical Guidance Cue */}
          <CoachingCue message={coachingCue} size="xl" />

          {/* Metrics Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <MetricCard
              label="Compression Depth"
              value={depthVal}
              tone={depthTone}
              target="50.0 - 60.0 mm"
              large
            />
            <MetricCard
              label="Compression Rate"
              value={rateVal}
              tone={rateTone}
              target="100 - 120 / min"
              large
            />
            <MetricCard
              label="Chest Recoil"
              value={recoilVal}
              tone={recoilTone}
              target="> 90%"
              large
            />
            <MetricCard
              label="Hand Position"
              value={session.pressureBalancePct !== null ? `${Math.round(session.pressureBalancePct)}%` : "—"}
              tone={placementTone}
              target="Centered Balance"
              large
            />
          </div>
        </div>

        {/* Right Side: Trainee Info & Timeline */}
        <div className="space-y-6">
          {/* Trainee Card */}
          <div className="bg-slate-900/40 border border-slate-800/80 p-6 rounded-2xl">
            <h3 className="text-[10px] font-bold text-slate-500 border-b border-slate-800 pb-3.5 uppercase tracking-widest">
              Trainee Profile
            </h3>
            <div className="mt-4 space-y-4 text-xs">
              <div className="flex justify-between items-center bg-slate-950 p-3.5 rounded-xl border border-slate-800/40">
                <span className="text-slate-400 font-semibold uppercase">Identifier</span>
                <span className="text-slate-100 font-bold font-mono text-sm">{session.traineeId || "Anonymous"}</span>
              </div>
              {session.scenario && (
                <div className="flex justify-between items-center bg-slate-950 p-3.5 rounded-xl border border-slate-800/40">
                  <span className="text-slate-400 font-semibold uppercase">Scenario</span>
                  <span className="text-slate-100 font-bold">{session.scenario}</span>
                </div>
              )}
              {session.notes && (
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/40">
                  <span className="text-slate-400 block font-semibold uppercase mb-1.5">Session Notes</span>
                  <span className="text-slate-300 leading-relaxed font-sans font-medium">{session.notes}</span>
                </div>
              )}
            </div>
          </div>

          {/* Clock Panel */}
          <div className="bg-slate-900/40 border border-slate-800/80 py-8 rounded-2xl flex items-center justify-center text-white">
            <SessionTimer startedAt={session.startedAt} active={session.active} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default InstructorLiveSessionPage;
