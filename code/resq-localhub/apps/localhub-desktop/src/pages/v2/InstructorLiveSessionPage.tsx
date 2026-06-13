import { useEffect, useState } from "react";
import { fetchSessionLive, endSession } from "../../api/sessionsApi";
import { subscribeToSessionLive } from "../../api/liveEventsClient";
import type { SessionLiveView } from "../../types/live";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";
import PageHeader from "../../components/ui/PageHeader";
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
    return <LoadingState message="Connecting to live session..." />;
  }

  if (error || !session) {
    return (
      <Card className="text-center max-w-lg mx-auto py-12">
        <h3 className="text-lg font-bold text-gray-900">Session Unavailable</h3>
        <p className="text-sm text-gray-500 mt-1">{error || "Unable to load session."}</p>
        <Button type="button" className="mt-6" onClick={() => onSessionEnded(sessionId)}>
          Return to Dashboard
        </Button>
      </Card>
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
    <div className="space-y-6">
      <PageHeader
        title="Live Session Monitor"
        subtitle={`Supervising training on manikin: ${session.deviceId}`}
        actions={
          <Button
            type="button"
            variant="danger"
            loading={ending}
            onClick={handleEndSession}
          >
            End Training Session
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Side: Session details & coaching cues */}
        <div className="lg:col-span-2 space-y-6">
          {/* Clinical Guidance Cue */}
          <CoachingCue message={coachingCue} size="xl" />

          {/* Metrics Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              target="Centered balance"
              large
            />
          </div>
        </div>

        {/* Right Side: Trainee Info & Timeline */}
        <div className="space-y-6">
          <Card>
            <h3 className="text-base font-semibold text-gray-900 border-b border-gray-100 pb-3">
              Trainee Profile
            </h3>
            <div className="mt-3 space-y-3 text-sm">
              <div>
                <span className="text-gray-400 block text-xs uppercase font-medium">Identifier</span>
                <span className="text-gray-800 font-semibold">{session.traineeId || "Anonymous"}</span>
              </div>
              {session.scenario && (
                <div>
                  <span className="text-gray-400 block text-xs uppercase font-medium">Scenario</span>
                  <span className="text-gray-800 font-semibold">{session.scenario}</span>
                </div>
              )}
              {session.notes && (
                <div>
                  <span className="text-gray-400 block text-xs uppercase font-medium">Notes</span>
                  <span className="text-gray-700">{session.notes}</span>
                </div>
              )}
            </div>
          </Card>

          <Card className="text-center py-6">
            <SessionTimer startedAt={session.startedAt} active={session.active} />
          </Card>
        </div>
      </div>
    </div>
  );
}

export default InstructorLiveSessionPage;
