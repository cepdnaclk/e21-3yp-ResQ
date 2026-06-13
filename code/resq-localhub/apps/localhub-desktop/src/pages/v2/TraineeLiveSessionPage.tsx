import { useEffect, useState } from "react";
import { fetchSessionLive } from "../../api/sessionsApi";
import { subscribeToSessionLive } from "../../api/liveEventsClient";
import type { SessionLiveView } from "../../types/live";
import Card from "../../components/ui/Card";
import LoadingState from "../../components/ui/LoadingState";
import { CoachingCue } from "../../components/cpr/CoachingCue";
import { SessionTimer } from "../../components/cpr/SessionTimer";
import { getCompressionCue } from "../../utils/userFriendlyLabels";

type TraineeLiveSessionPageProps = {
  sessionId: string;
  onSessionEnded: (sessionId: string) => void;
};

export function TraineeLiveSessionPage({
  sessionId,
  onSessionEnded,
}: TraineeLiveSessionPageProps) {
  const [session, setSession] = useState<SessionLiveView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let subscription: { stop: () => void } | null = null;
    let stopped = false;

    async function init() {
      try {
        const initial = await fetchSessionLive(sessionId);
        if (stopped) return;
        if (!initial) {
          setError("The active session could not be found.");
          setLoading(false);
          return;
        }

        setSession(initial);
        setLoading(false);

        // Subscribe to live SSE updates
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
            console.warn("Trainee session SSE error", err);
          }
        );
      } catch (err) {
        if (!stopped) {
          setError("Failed to stream session updates.");
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

  if (loading) {
    return <LoadingState message="Connecting to training session monitor..." />;
  }

  if (error || !session) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="text-center max-w-md w-full">
          <h3 className="text-lg font-bold text-gray-900">Session Closed</h3>
          <p className="text-sm text-gray-500 mt-1">{error || "The training session has ended."}</p>
        </Card>
      </div>
    );
  }

  const cue = getCompressionCue(
    session.latestMetric,
    session.latestFlags,
    session.connectionState,
    session.active
  );

  const recoilOkCount = session.latestMetric?.recoilOkCount || 0;
  const incompleteRecoilCount = session.latestMetric?.incompleteRecoilCount || 0;
  const recoilTotal = recoilOkCount + incompleteRecoilCount;
  const derivedRecoilPct = recoilTotal > 0 ? (recoilOkCount / recoilTotal) * 100 : null;

  // Derive visual indicators
  const depthGood = session.latestDepthMm && session.latestDepthMm >= 45 && session.latestDepthMm <= 55;
  const rateGood = session.latestRateCpm && session.latestRateCpm >= 100 && session.latestRateCpm <= 120;
  const recoilGood = derivedRecoilPct !== null && derivedRecoilPct >= 90;

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col justify-between p-6">
      {/* Top Header */}
      <div className="flex justify-between items-center border-b border-gray-800 pb-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-gray-100">ResQ Trainee Guide</h1>
          <p className="text-xs text-gray-400 mt-0.5">Perform compressions on the chest sensor.</p>
        </div>
        <div className="bg-gray-800 px-4 py-2 rounded-xl">
          <SessionTimer startedAt={session.startedAt} active={session.active} />
        </div>
      </div>

      {/* Main Focus Cue */}
      <div className="flex-1 flex flex-col justify-center max-w-4xl mx-auto w-full my-8">
        <CoachingCue message={cue} size="xl" />
      </div>

      {/* Simple indicators */}
      <div className="grid grid-cols-3 gap-6 max-w-4xl mx-auto w-full border-t border-gray-800 pt-6">
        <div className="text-center">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-2">Depth</span>
          <div
            className={`mx-auto w-4 h-4 rounded-full ${
              session.latestDepthMm ? (depthGood ? "bg-green-500" : "bg-yellow-500") : "bg-gray-700"
            }`}
          />
          <span className="text-xs text-gray-400 mt-1 block">
            {session.latestDepthMm ? (depthGood ? "Ideal Depth" : "Adjust Depth") : "Waiting"}
          </span>
        </div>

        <div className="text-center">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-2">Rhythm</span>
          <div
            className={`mx-auto w-4 h-4 rounded-full ${
              session.latestRateCpm ? (rateGood ? "bg-green-500" : "bg-yellow-500") : "bg-gray-700"
            }`}
          />
          <span className="text-xs text-gray-400 mt-1 block">
            {session.latestRateCpm ? (rateGood ? "Steady Rhythm" : "Adjust Speed") : "Waiting"}
          </span>
        </div>

        <div className="text-center">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-2">Chest Release</span>
          <div
            className={`mx-auto w-4 h-4 rounded-full ${
              derivedRecoilPct !== null ? (recoilGood ? "bg-green-500" : "bg-yellow-500") : "bg-gray-700"
            }`}
          />
          <span className="text-xs text-gray-400 mt-1 block">
            {derivedRecoilPct !== null ? (recoilGood ? "Fully Released" : "Release Fully") : "Waiting"}
          </span>
        </div>
      </div>
    </div>
  );
}

export default TraineeLiveSessionPage;
