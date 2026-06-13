import { useEffect, useState } from "react";
import { fetchSessionLive, fetchCompletedSession } from "../../api/sessionsApi";
import { subscribeToSessionLive } from "../../api/liveEventsClient";
import type { SessionLiveView } from "../../types/live";
import type { CompletedSession } from "../../types/session";
import LoadingState from "../../components/ui/LoadingState";
import { CoachingCue } from "../../components/cpr/CoachingCue";
import { SessionTimer } from "../../components/cpr/SessionTimer";
import { MetricCard } from "../../components/cpr/MetricCard";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import { getCompressionCue, formatDuration } from "../../utils/userFriendlyLabels";
import { useAuth } from "../../auth/AuthContext";

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
  const { currentUser, logout } = useAuth();

  const [completedSession, setCompletedSession] = useState<CompletedSession | null>(null);
  const [fetchingCompleted, setFetchingCompleted] = useState(false);

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
            if (!stopped) {
              setSession(update);
              if (update.active === false || update.sessionActive === false) {
                subscription?.stop();
              }
            }
          },
          () => {
            if (!stopped) {
              setSession((prev) => prev ? { ...prev, active: false } : null);
              subscription?.stop();
            }
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

  useEffect(() => {
    if (session && !session.active) {
      setFetchingCompleted(true);
      async function loadCompleted() {
        try {
          const data = await fetchCompletedSession(sessionId);
          setCompletedSession(data);
        } catch (err) {
          console.warn("Failed to load completed session summary", err);
        } finally {
          setFetchingCompleted(false);
        }
      }
      loadCompleted();
    }
  }, [session?.active, sessionId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-8 text-white">
        <LoadingState message="Connecting to training session monitor..." />
      </div>
    );
  }

  if (session && !session.active && !completedSession) {
    return (
      <div className="min-h-screen bg-gradient-to-tr from-slate-100 via-teal-50/20 to-slate-50 flex flex-col items-center justify-center p-8 text-slate-800">
        <LoadingState message="Processing session completion summary..." />
      </div>
    );
  }

  if (completedSession) {
    const summary = completedSession.summary;
    const score = summary.score;
    const isExcellent = score >= 85;
    const isGood = score >= 70 && score < 85;
    const scoreClass = isExcellent
      ? "bg-emerald-50 text-emerald-800 border-emerald-100"
      : isGood
      ? "bg-amber-50 text-amber-800 border-amber-100"
      : "bg-rose-50 text-rose-800 border-rose-100";

    const hasDepthProgress = summary.avgDepthProgress !== null && summary.avgDepthProgress !== undefined;
    const hasRecoilPct = summary.recoilPct !== null && summary.recoilPct !== undefined;

    return (
      <div className="min-h-screen bg-gradient-to-tr from-slate-100 via-teal-50/20 to-slate-50 text-slate-800 flex flex-col justify-between p-8 font-sans select-none animate-fadeIn">
        {/* Top Header */}
        <header className="flex justify-between items-center border-b border-slate-200/80 pb-5 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center p-1.5 shrink-0">
              <img src="/resq-logo-dark-512.png" alt="ResQ Logo" className="w-full h-full object-contain brightness-0 invert" />
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tight text-slate-900 leading-tight">ResQ Practice Portal</h1>
              <p className="text-[10px] text-teal-600 font-extrabold uppercase tracking-wider mt-0.5">Session Completed</p>
            </div>
          </div>
        </header>

        {/* Main Completion Card */}
        <main className="flex-1 flex flex-col items-center justify-center my-8 max-w-xl w-full mx-auto">
          <Card className="p-8 text-center space-y-6 border border-slate-100 w-full shadow-2xl animate-scaleUp bg-white rounded-[32px]">
            <div className="space-y-2">
              <span className="text-[10px] font-extrabold bg-teal-50 text-teal-700 px-3 py-1.5 rounded-full uppercase tracking-wider inline-block border border-teal-100">
                Practice Finished
              </span>
              <h2 className="text-2xl font-black text-slate-800 tracking-tight leading-tight">Session completed</h2>
            </div>

            {/* Score circle */}
            <div className="flex justify-center">
              <div className={`w-32 h-32 rounded-full border-4 flex flex-col items-center justify-center bg-white shadow-md ${scoreClass}`}>
                <span className="text-4xl font-black">{score}%</span>
                <span className="text-[9px] font-extrabold uppercase tracking-wider opacity-60">Score</span>
              </div>
            </div>

            {/* Metrics list */}
            <div className="grid grid-cols-2 gap-4 text-left pt-2">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100/50">
                <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">Duration</span>
                <span className="text-sm text-slate-700 font-bold">{formatDuration(summary.durationSeconds)}</span>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100/50">
                <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">Compressions</span>
                <span className="text-sm text-slate-700 font-bold">
                  {summary.totalCompressions} <span className="text-xs text-slate-400 font-semibold">({summary.validCompressions} valid)</span>
                </span>
              </div>
              
              {hasDepthProgress && (
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100/50">
                  <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">Good Depth</span>
                  <span className="text-sm text-slate-700 font-bold font-mono">
                    {Math.round(summary.avgDepthProgress! * 100)}%
                  </span>
                </div>
              )}
              
              {hasRecoilPct && (
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100/50">
                  <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">Recoil Accuracy</span>
                  <span className="text-sm text-slate-700 font-bold font-mono">
                    {Math.round(summary.recoilPct!)}%
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-slate-50">
              <Button
                type="button"
                variant="secondary"
                onClick={() => window.location.assign("/")}
                className="flex-1 font-bold text-xs py-3 rounded-xl"
              >
                Back to My Dashboard
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => window.location.assign(`/sessions/${sessionId}`)}
                className="flex-1 font-bold text-xs py-3 rounded-xl text-white shadow-md shadow-teal-500/10"
              >
                View Session Summary
              </Button>
            </div>
          </Card>
        </main>

        <footer className="text-center text-[10px] text-slate-400 font-bold uppercase tracking-wider pt-4 border-t border-slate-200/80 shrink-0">
          ResQ CPR Monitor • Connected to LocalHub host
        </footer>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 text-white font-sans">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 p-10 rounded-3xl text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mx-auto text-slate-400 font-bold">
            !
          </div>
          <h3 className="text-lg font-bold">Session Closed</h3>
          <p className="text-sm text-slate-400">{error || "The training session has ended."}</p>
        </div>
      </div>
    );
  }

  const rawCue = getCompressionCue(
    session.latestMetric,
    session.latestFlags,
    session.connectionState,
    session.active
  );

  // Normalize cue text for trainee based on design copy
  let cue = rawCue;
  if (cue === "Waiting for signal…") {
    if (session.connectionState === "STALE" || session.connectionState === "OFFLINE" || session.connectionState === "ERROR") {
      cue = "Reconnecting…";
    }
  } else if (cue === "Release fully between compressions") {
    cue = "Release fully";
  } else if (cue === "Good compressions — keep it up!") {
    cue = "Good compressions";
  } else if (cue === "Keep going — avoid pauses") {
    cue = "Keep going";
  }

  const recoilOkCount = session.latestMetric?.recoilOkCount || 0;
  const incompleteRecoilCount = session.latestMetric?.incompleteRecoilCount || 0;
  const recoilTotal = recoilOkCount + incompleteRecoilCount;
  const derivedRecoilPct = recoilTotal > 0 ? (recoilOkCount / recoilTotal) * 100 : null;

  // Profile parsing (Correction 5)
  const profile = session.scenario && session.scenario.toLowerCase().includes("pediatric") ? "pediatric" : "adult";
  const depthTargetStr = profile === "pediatric" ? "40–50 mm" : "50–60 mm";

  // Parse flags
  const flags = new Set(
    (Array.isArray(session.latestFlags) ? session.latestFlags : (session.latestFlags || "").split(","))
      .map((f) => f.trim().toUpperCase())
  );

  // Depth Card Values
  let depthVal = "Waiting";
  let depthTone: "good" | "warning" | "danger" | "neutral" = "neutral";
  if (session.latestDepthMm !== null && session.latestDepthMm !== undefined && session.latestDepthMm > 0) {
    if (flags.has("DEPTH_OK")) {
      depthVal = "Good";
      depthTone = "good";
    } else if (flags.has("DEPTH_LOW")) {
      depthVal = "Too shallow";
      depthTone = "danger";
    } else if (flags.has("DEPTH_HIGH")) {
      depthVal = "Too deep";
      depthTone = "warning";
    } else {
      // Numerical fallback
      const minDepth = profile === "pediatric" ? 40 : 50;
      const maxDepth = profile === "pediatric" ? 50 : 60;
      if (session.latestDepthMm < minDepth) {
        depthVal = "Too shallow";
        depthTone = "danger";
      } else if (session.latestDepthMm > maxDepth) {
        depthVal = "Too deep";
        depthTone = "warning";
      } else {
        depthVal = "Good";
        depthTone = "good";
      }
    }
  }

  // Rate Card Values
  let rateVal = "Waiting";
  let rateTone: "good" | "warning" | "danger" | "neutral" = "neutral";
  if (session.latestRateCpm !== null && session.latestRateCpm !== undefined && session.latestRateCpm > 0) {
    if (flags.has("RATE_OK")) {
      rateVal = "Good rhythm";
      rateTone = "good";
    } else if (flags.has("RATE_SLOW")) {
      rateVal = "Speed up";
      rateTone = "danger";
    } else if (flags.has("RATE_FAST")) {
      rateVal = "Slow down";
      rateTone = "warning";
    } else {
      // Numerical fallback
      if (session.latestRateCpm < 100) {
        rateVal = "Speed up";
        rateTone = "danger";
      } else if (session.latestRateCpm > 120) {
        rateVal = "Slow down";
        rateTone = "warning";
      } else {
        rateVal = "Good rhythm";
        rateTone = "good";
      }
    }
  }

  // Recoil Card Values (Correction 4)
  let recoilVal = "Waiting";
  let recoilTone: "good" | "warning" | "danger" | "neutral" = "neutral";
  if (session.latestMetric && session.latestMetric.compressionCount !== null && session.latestMetric.compressionCount !== undefined && session.latestMetric.compressionCount > 0) {
    const isRecoilOk = session.latestMetric.recoilOk !== false && !flags.has("RECOIL_INCOMPLETE") && !flags.has("INCOMPLETE_RECOIL");
    if (isRecoilOk) {
      recoilVal = "Good";
      recoilTone = "good";
    } else {
      recoilVal = "Release fully";
      recoilTone = "danger";
    }
  }

  // Hands Card Values
  let handsVal = "Waiting";
  let handsTone: "good" | "warning" | "danger" | "neutral" = "neutral";
  if (session.latestMetric && session.latestMetric.compressionCount !== null && session.latestMetric.compressionCount !== undefined && session.latestMetric.compressionCount > 0) {
    const hasPlacementWarn = flags.has("HAND_PLACEMENT_WARNING") || session.pressureSkewed === true;
    if (hasPlacementWarn) {
      handsVal = "Check position";
      handsTone = "warning";
    } else {
      handsVal = "Centered";
      handsTone = "good";
    }
  }

  // Coaching cue tone mapping
  function getTraineeCueTone(cueMsg: string): "good" | "warning" | "danger" | "neutral" | "muted" {
    const msg = cueMsg.toLowerCase();
    if (msg.includes("good") || msg.includes("centered") || msg.includes("rhythm") || msg.includes("keep it up")) return "good";
    if (msg.includes("deeper") || msg.includes("release fully") || msg.includes("recoil")) return "danger";
    if (msg.includes("position") || msg.includes("speed up") || msg.includes("slow down") || msg.includes("lighter") || msg.includes("avoid pauses") || msg.includes("keep going")) return "warning";
    return "muted";
  }

  const resolvedCueTone = getTraineeCueTone(cue);
  const compressionCount = session.latestMetric?.compressionCount ?? 0;

  return (
    <div className="min-h-screen bg-gradient-to-tr from-slate-100 via-teal-50/20 to-slate-50 text-slate-800 flex flex-col justify-between p-8 font-sans select-none animate-fadeIn">
      {/* Top Header */}
      <header className="flex justify-between items-center border-b border-slate-200/80 pb-5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center p-1.5 shrink-0">
            <img src="/resq-logo-dark-512.png" alt="ResQ Logo" className="w-full h-full object-contain brightness-0 invert" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight text-slate-900 leading-tight">ResQ Live Practice</h1>
            <p className="text-[10px] text-teal-600 font-extrabold uppercase tracking-wider mt-0.5">
              {session.scenario || "Standard CPR Training"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-5">
          {/* Timer & Compressions Badges */}
          <div className="flex items-center gap-3 bg-white border border-slate-200/80 rounded-2xl px-5 py-2 shadow-sm">
            <SessionTimer startedAt={session.startedAt} active={session.active} />
            <div className="w-px h-8 bg-slate-200" />
            <div className="flex flex-col items-center py-1">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">Compressions</span>
              <span className="text-xl font-mono font-extrabold text-slate-800 tracking-tight">{compressionCount}</span>
            </div>
          </div>

          {currentUser && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500 font-semibold">
                Signed in as <strong className="text-slate-700">{currentUser.displayName}</strong>
              </span>
              <button
                type="button"
                onClick={() => {
                  logout().finally(() => window.location.assign("/login"));
                }}
                className="bg-white hover:bg-slate-50 text-slate-800 font-bold text-xs px-3.5 py-2.5 rounded-xl transition-all duration-200 border border-slate-200/80 cursor-pointer shadow-sm"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main split display: side metrics + center dial */}
      <main className="flex-1 flex flex-col items-center justify-center my-10 max-w-5xl mx-auto w-full gap-10">
        
        {/* Large Central Coaching Cue Card */}
        <div className="w-full max-w-3xl animate-scaleUp">
          <CoachingCue
            message={cue}
            tone={resolvedCueTone}
            size="2xl"
          />
        </div>

        {/* 4 simple clinical V2 metric cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 w-full mt-2">
          <MetricCard
            label="Depth"
            value={depthVal}
            unit={session.latestDepthMm ? `(${session.latestDepthMm.toFixed(0)} mm)` : undefined}
            tone={depthTone}
            target={depthTargetStr}
            large={true}
          />
          <MetricCard
            label="Rate"
            value={rateVal}
            unit={session.latestRateCpm ? `(${Math.round(session.latestRateCpm)}/min)` : undefined}
            tone={rateTone}
            target="100–120 / min"
            large={true}
          />
          <MetricCard
            label="Recoil"
            value={recoilVal}
            unit={derivedRecoilPct !== null ? `(${Math.round(derivedRecoilPct)}%)` : undefined}
            tone={recoilTone}
            target="≥ 90% Recoil"
            large={true}
          />
          <MetricCard
            label="Hands"
            value={handsVal}
            tone={handsTone}
            target="Centered"
            large={true}
          />
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center text-[10px] text-slate-400 font-bold uppercase tracking-wider pt-4 border-t border-slate-200/80">
        ResQ Live Telemetry Guide • Visible from distance
      </footer>
    </div>
  );
}

export default TraineeLiveSessionPage;
