import { useEffect, useState, useMemo } from "react";
import { fetchLiveManikins } from "../../api/manikinsApi";
import { subscribeToManikinsLive } from "../../api/liveEventsClient";
import { fetchTrainees } from "../../api/traineesApi";
import { endSession } from "../../api/sessionsApi";
import type { ManikinLiveSummary } from "../../types/manikin";
import type { TraineeRecord } from "../../types/trainee";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";
import PageHeader from "../../components/ui/PageHeader";
import StatusBadge from "../../components/ui/StatusBadge";
import { getCompressionCue } from "../../utils/userFriendlyLabels";

type ActiveSessionsPageProps = {
  onViewLive: (sessionId: string) => void;
  onNavigateHome: () => void;
};

function ElapsedTime({ startedAt }: { startedAt: string | null }) {
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    if (!startedAt) {
      setElapsed("—");
      return;
    }
    const startMs = new Date(startedAt).getTime();

    function update() {
      const diffSecs = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
      const mins = Math.floor(diffSecs / 60);
      const secs = diffSecs % 60;
      setElapsed(`${mins}:${String(secs).padStart(2, "0")}`);
    }

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return <span className="font-mono text-slate-800 font-bold">{elapsed}</span>;
}

export function ActiveSessionsPage({ onViewLive, onNavigateHome }: ActiveSessionsPageProps) {
  const [manikins, setManikins] = useState<ManikinLiveSummary[]>([]);
  const [trainees, setTrainees] = useState<TraineeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [endingSessionId, setEndingSessionId] = useState<string | null>(null);

  // Fetch initial list
  async function loadData() {
    try {
      const [manikinsRes, traineesRes] = await Promise.all([
        fetchLiveManikins(),
        fetchTrainees().catch(() => []),
      ]);
      setManikins(manikinsRes);
      setTrainees(traineesRes);
    } catch (err) {
      console.error("Failed to load active sessions data", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();

    // Subscribe to SSE updates for live data
    const subscription = subscribeToManikinsLive(
      (updatedManikins) => {
        setManikins(updatedManikins);
      },
      (err) => {
        console.warn("Manikins live stream connection issue in active sessions monitor:", err);
      }
    );

    return () => {
      subscription.stop();
    };
  }, []);

  // Filter manikins with active sessions
  const activeSessions = useMemo(() => {
    return manikins.filter((m) => m.activeSessionId != null && m.activeSessionId !== "");
  }, [manikins]);

  // Create trainee map for quick lookup
  const traineeMap = useMemo(() => {
    const map = new Map<string, string>();
    trainees.forEach((t) => {
      map.set(t.id, t.displayName);
    });
    return map;
  }, [trainees]);

  async function handleEndSession(sessionId: string) {
    if (!window.confirm("Are you sure you want to end this CPR training session?")) {
      return;
    }

    setEndingSessionId(sessionId);
    try {
      await endSession({ sessionId });
      // Reload list instantly
      const updated = await fetchLiveManikins();
      setManikins(updated);
    } catch (err) {
      alert("Failed to end session: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setEndingSessionId(null);
    }
  }

  if (loading) {
    return <LoadingState message="Loading active sessions..." />;
  }

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <PageHeader
        title="Live Active Sessions"
        subtitle="Monitor ongoing CPR practices and view student performance in real-time."
        actions={
          <Button type="button" variant="secondary" onClick={onNavigateHome}>
            Back to Home
          </Button>
        }
      />

      {activeSessions.length === 0 ? (
        <Card className="text-center py-20 border border-dashed border-slate-200 max-w-md mx-auto animate-fadeIn">
          <div className="text-slate-300 text-4xl mb-4 font-black">🎯</div>
          <p className="text-slate-600 text-sm font-bold">No active sessions right now.</p>
          <p className="text-slate-400 text-xs mt-1.5 leading-relaxed">
            Start a training session from the courses roster or dashboard to monitor trainee progress here.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {activeSessions.map((m) => {
            const traineeName = m.activeTraineeId
              ? traineeMap.get(m.activeTraineeId) || m.activeTraineeId
              : "Anonymous Trainee";

            const cue = getCompressionCue(
              m.latestMetric,
              m.latestFlags,
              m.connectionState,
              m.sessionActive
            );

            // Metrics calculation
            const depth = m.latestDepthMm ?? 0;
            const rate = m.latestRateCpm ?? 0;
            const recoil = m.latestRecoilOk ?? false;
            const compressions = m.latestCompressionCount ?? 0;

            const depthOk = depth >= 50 && depth <= 60;
            const rateOk = rate >= 100 && rate <= 120;

            return (
              <Card
                key={m.activeSessionId}
                className="border border-slate-100 hover:shadow-lg transition-shadow duration-300 flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-start gap-4">
                    <div>
                      <h3 className="text-sm font-black text-slate-800 leading-tight">
                        {traineeName}
                      </h3>
                      <p className="text-[10px] text-teal-600 font-extrabold uppercase tracking-widest mt-1">
                        {m.activeSessionScenario || "Standard CPR Training"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="flex h-2 w-2 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                      </span>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Live Monitor
                      </span>
                    </div>
                  </div>

                  {/* Core Context Detail Grid */}
                  <div className="grid grid-cols-2 gap-4 bg-slate-50/50 border border-slate-100/50 rounded-xl p-3.5 mt-4 text-xs font-semibold text-slate-500">
                    <div>
                      <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                        Assigned Trainer
                      </span>
                      <span className="text-slate-800 text-xs mt-0.5 block">{m.deviceId}</span>
                    </div>
                    <div>
                      <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                        Elapsed Time
                      </span>
                      <span className="mt-0.5 block">
                        <ElapsedTime startedAt={m.activeSessionStartedAt} />
                      </span>
                    </div>
                  </div>

                  {/* Clinical Live Coaching Cue */}
                  <div className="mt-4 p-3 bg-teal-50/50 border border-teal-100/60 rounded-xl">
                    <span className="block text-[8px] text-teal-600 font-bold uppercase tracking-widest">
                      Latest Performance Cue
                    </span>
                    <span className="text-xs text-teal-800 font-extrabold block mt-0.5 truncate">
                      {cue}
                    </span>
                  </div>

                  {/* Compact Metrics list */}
                  <div className="grid grid-cols-4 gap-3 mt-4 text-center">
                    <div className="bg-slate-50 rounded-lg p-2">
                      <span className="block text-[8px] font-bold text-slate-400 uppercase tracking-widest">
                        Depth
                      </span>
                      <span
                        className={`text-xs font-black block mt-0.5 ${
                          depthOk ? "text-emerald-600" : "text-rose-600"
                        }`}
                      >
                        {depth > 0 ? `${depth.toFixed(0)} mm` : "—"}
                      </span>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2">
                      <span className="block text-[8px] font-bold text-slate-400 uppercase tracking-widest">
                        Rate
                      </span>
                      <span
                        className={`text-xs font-black block mt-0.5 ${
                          rateOk ? "text-emerald-600" : "text-rose-600"
                        }`}
                      >
                        {rate > 0 ? `${rate.toFixed(0)} cpm` : "—"}
                      </span>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2">
                      <span className="block text-[8px] font-bold text-slate-400 uppercase tracking-widest">
                        Recoil
                      </span>
                      <span
                        className={`text-xs font-black block mt-0.5 ${
                          recoil ? "text-emerald-600" : "text-rose-600"
                        }`}
                      >
                        {compressions > 0 ? (recoil ? "Good" : "Fix") : "—"}
                      </span>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2">
                      <span className="block text-[8px] font-bold text-slate-400 uppercase tracking-widest">
                        Count
                      </span>
                      <span className="text-xs font-black text-slate-800 block mt-0.5">
                        {compressions}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card footer actions */}
                <div className="flex gap-3 pt-5 border-t border-slate-100 mt-5">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="flex-1 font-bold bg-white text-xs py-2"
                    onClick={() => m.activeSessionId && handleEndSession(m.activeSessionId)}
                    disabled={endingSessionId === m.activeSessionId}
                  >
                    {endingSessionId === m.activeSessionId ? "Ending..." : "End Session"}
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    className="flex-1 font-bold text-xs py-2 shadow-md"
                    onClick={() => m.activeSessionId && onViewLive(m.activeSessionId)}
                  >
                    View Live
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ActiveSessionsPage;
