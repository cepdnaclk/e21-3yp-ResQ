import { useEffect, useState } from "react";
import { fetchSessionLive, fetchCompletedSession } from "../../api/sessionsApi";
import { subscribeToSessionLive } from "../../api/liveEventsClient";
import type { SessionLiveView } from "../../types/live";
import type { CompletedSession } from "../../types/session";
import LoadingState from "../../components/ui/LoadingState";
import { SessionTimer } from "../../components/cpr/SessionTimer";
import { MetricCard } from "../../components/cpr/MetricCard";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import { getCompressionCue, formatDuration } from "../../utils/userFriendlyLabels";
import { useAuth } from "../../auth/AuthContext";
import { normalizeTelemetry } from "../../utils/telemetryNormalization";
import LiveCprGraph from "../../components/cpr/LiveCprGraph";
import LiveCoachingBanner from "../../components/cpr/LiveCoachingBanner";

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
              setSession((prev) => (prev ? { ...prev, active: false } : null));
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
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-8 text-slate-800">
        <LoadingState message="Connecting to training session monitor..." />
      </div>
    );
  }

  if (session && !session.active && !completedSession) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-8 text-slate-800">
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
      ? "bg-emerald-50 text-emerald-600 border-emerald-200"
      : isGood
      ? "bg-amber-50 text-amber-600 border-amber-200"
      : "bg-rose-50 text-rose-600 border-rose-200";

    const hasDepthProgress = summary.avgDepthProgress !== null && summary.avgDepthProgress !== undefined;
    const hasRecoilPct = summary.recoilPct !== null && summary.recoilPct !== undefined;

    return (
      <div className="min-h-screen bg-[#F8FAFC] text-slate-800 flex flex-col justify-between p-6 sm:p-8 font-sans select-none animate-fadeIn">
        {/* Top Header */}
        <header className="flex justify-between items-center border-b border-slate-200 pb-5 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-teal-650 flex items-center justify-center p-1.5 shrink-0">
              <img
                src="/resq-logo-dark-512.png"
                alt="ResQ Logo"
                className="w-full h-full object-contain brightness-0 invert"
              />
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tight text-slate-900 leading-tight">ResQ Practice Portal</h1>
              <p className="text-[10px] text-teal-600 font-extrabold uppercase tracking-wider mt-0.5">
                Session Completed
              </p>
            </div>
          </div>
        </header>

        {/* Main Completion Card */}
        <main className="flex-1 flex flex-col items-center justify-center my-8 max-w-xl w-full mx-auto">
          <div className="p-8 text-center space-y-6 border border-slate-200 w-full shadow-sm bg-white rounded-3xl">
            <div className="space-y-2">
              <span className="text-[10px] font-extrabold bg-teal-50 text-teal-700 px-3 py-1.5 rounded-full uppercase tracking-wider inline-block border border-teal-200">
                Practice Finished
              </span>
              <h2 className="text-2xl font-black text-slate-950 tracking-tight leading-tight">
                Session completed
              </h2>
            </div>

            {/* Score circle */}
            <div className="flex justify-center">
              <div
                className={`w-32 h-32 rounded-full border flex flex-col items-center justify-center shadow-sm ${scoreClass}`}
              >
                <span className="text-4xl font-black">{score}%</span>
                <span className="text-[9px] font-extrabold uppercase tracking-wider opacity-85">Score</span>
              </div>
            </div>

            {/* Metrics list */}
            <div className="grid grid-cols-2 gap-4 text-left pt-2">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/60">
                <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">Duration</span>
                <span className="text-sm text-slate-800 font-bold">{formatDuration(summary.durationSeconds)}</span>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/60">
                <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                  Compressions
                </span>
                <span className="text-sm text-slate-800 font-bold">
                  {summary.totalCompressions}{" "}
                  <span className="text-xs text-slate-500 font-semibold">({summary.validCompressions} valid)</span>
                </span>
              </div>

              {hasDepthProgress && (
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/60">
                  <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                    Good Depth
                  </span>
                  <span className="text-sm text-slate-800 font-bold font-mono">
                    {Math.round(summary.avgDepthProgress! * 100)}%
                  </span>
                </div>
              )}

              {hasRecoilPct && (
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/60">
                  <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                    Recoil Accuracy
                  </span>
                  <span className="text-sm text-slate-800 font-bold font-mono">{Math.round(summary.recoilPct!)}%</span>
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-slate-100">
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
                className="flex-1 font-bold text-xs py-3 rounded-xl text-white shadow-sm"
              >
                View Session Summary
              </Button>
            </div>
          </div>
        </main>

        <footer className="text-center text-[10px] text-slate-400 font-bold uppercase tracking-wider pt-4 border-t border-slate-200 shrink-0">
          ResQ CPR Monitor • Connected to LocalHub host
        </footer>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center p-8 text-slate-800">
        <div className="w-full max-w-md bg-white border border-slate-200 p-10 rounded-3xl text-center space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-500 font-bold">
            !
          </div>
          <h3 className="text-lg font-bold text-slate-900">Session Closed</h3>
          <p className="text-sm text-slate-500">{error || "The training session has ended."}</p>
        </div>
      </div>
    );
  }

  const normalized = normalizeTelemetry(session);

  // Profile parsing
  const profile = session.scenario && session.scenario.toLowerCase().includes("pediatric") ? "pediatric" : "adult";
  const depthTargetStr = profile === "pediatric" ? "40–50 mm" : "50–60 mm";

  // Parse flags
  const flags = new Set(
    (Array.isArray(normalized.flags) ? normalized.flags : (normalized.flags || "").split(",")).map((f) =>
      f.trim().toUpperCase()
    )
  );

  // Depth Card Values
  let depthVal = "—";
  let depthTone: "good" | "warning" | "danger" | "neutral" = "neutral";
  let depthStatus = "Waiting";

  if (normalized.depthMm !== null && normalized.depthMm !== undefined && normalized.depthMm > 0) {
    depthVal = `${normalized.depthMm.toFixed(1)}`;
    if (flags.has("DEPTH_OK")) {
      depthStatus = "Good";
      depthTone = "good";
    } else if (flags.has("DEPTH_LOW")) {
      depthStatus = "Too shallow";
      depthTone = "danger";
    } else if (flags.has("DEPTH_HIGH")) {
      depthStatus = "Too deep";
      depthTone = "warning";
    } else {
      const minDepth = profile === "pediatric" ? 40 : 50;
      const maxDepth = profile === "pediatric" ? 50 : 60;
      if (normalized.depthMm < minDepth) {
        depthStatus = "Too shallow";
        depthTone = "danger";
      } else if (normalized.depthMm > maxDepth) {
        depthStatus = "Too deep";
        depthTone = "warning";
      } else {
        depthStatus = "Good";
        depthTone = "good";
      }
    }
  }

  // Rate Card Values
  let rateVal = "—";
  let rateTone: "good" | "warning" | "danger" | "neutral" = "neutral";
  let rateStatus = "Waiting";

  if (normalized.rateCpm !== null && normalized.rateCpm !== undefined && normalized.rateCpm > 0) {
    rateVal = `${Math.round(normalized.rateCpm)}`;
    if (flags.has("RATE_OK")) {
      rateStatus = "Good";
      rateTone = "good";
    } else if (flags.has("RATE_SLOW")) {
      rateStatus = "Too slow";
      rateTone = "danger";
    } else if (flags.has("RATE_FAST")) {
      rateStatus = "Too fast";
      rateTone = "warning";
    } else {
      if (normalized.rateCpm < 100) {
        rateStatus = "Too slow";
        rateTone = "danger";
      } else if (normalized.rateCpm > 120) {
        rateStatus = "Too fast";
        rateTone = "warning";
      } else {
        rateStatus = "Good";
        rateTone = "good";
      }
    }
  }

  // Recoil Card Values
  let recoilVal = "—";
  let recoilTone: "good" | "warning" | "danger" | "neutral" = "neutral";
  let recoilStatus = "Waiting";

  if (normalized.hasRecoilCounts && normalized.recoilTotal === 0) {
    recoilVal = "Waiting for completed recoil data";
    recoilTone = "neutral";
    recoilStatus = "Waiting";
  } else if (normalized.recoilPct !== null) {
    recoilVal = `${Math.round(normalized.recoilPct)}`;
    if (normalized.recoilPct >= 90) {
      recoilStatus = "Good";
      recoilTone = "good";
    } else {
      recoilStatus = "Release fully";
      recoilTone = "danger";
    }
  }

  // Hands Card Values
  let handsVal = "—";
  let handsUnit = undefined;
  let handsTone: "good" | "warning" | "danger" | "neutral" = "neutral";
  let handsStatus = "Waiting";

  const cleanPlacement = (normalized.handPlacement || "").trim().toUpperCase();
  if (cleanPlacement) {
    handsStatus = cleanPlacement === "CENTER" ? "Good" : "Check Position";
    if (cleanPlacement === "CENTER") {
      handsVal = "Centered";
      handsTone = "good";
    } else if (cleanPlacement === "LEFT") {
      handsVal = "Left leaning";
      handsTone = "danger";
    } else if (cleanPlacement === "RIGHT") {
      handsVal = "Right leaning";
      handsTone = "danger";
    } else if (cleanPlacement === "NO_CONTACT") {
      handsVal = "No Contact";
      handsTone = "neutral";
    }

    if (session.pressureBalancePct !== null) {
      handsUnit = `(${Math.round(session.pressureBalancePct)}% balance)`;
    }
  } else if (session.pressureBalancePct !== null) {
    handsUnit = `(${Math.round(session.pressureBalancePct)}% balance)`;
    handsTone = session.pressureSkewed ? "danger" : "good";
    handsVal = session.pressureSkewed ? "Left leaning" : "Centered";
    handsStatus = session.pressureSkewed ? "Check Position" : "Good";
  }

  const compressionCount = session.latestMetric?.compressionCount ?? 0;

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800 flex flex-col justify-between p-6 sm:p-8 font-sans select-none animate-fadeIn">
      {/* Top Header */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-5 gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-teal-650 flex items-center justify-center p-1.5 shrink-0">
            <img
              src="/resq-logo-dark-512.png"
              alt="ResQ Logo"
              className="w-full h-full object-contain brightness-0 invert"
            />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight text-slate-900 leading-none">ResQ Live Practice</h1>
            <p className="text-[10px] text-teal-600 font-extrabold uppercase tracking-wider mt-0.5">
              {session.scenario || "Standard CPR Training"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-5">
          {/* Timer & Compressions Badges */}
          <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-2xl px-5 py-2 shadow-sm">
            <SessionTimer startedAt={session.startedAt} active={session.active} />
            <div className="w-px h-8 bg-slate-200" />
            <div className="flex flex-col items-center py-1">
              <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider block">
                Compressions
              </span>
              <span className="text-xl font-mono font-extrabold text-slate-800 tracking-tight">
                {compressionCount}
              </span>
            </div>
          </div>

          {currentUser && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500 font-semibold">
                Signed in as <strong className="text-slate-900">{currentUser.displayName}</strong>
              </span>
              <button
                type="button"
                onClick={() => {
                  logout().finally(() => window.location.assign("/login"));
                }}
                className="bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs px-3.5 py-2.5 rounded-xl transition-all duration-200 border border-slate-200 cursor-pointer shadow-sm"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main split display: side metrics + center dial */}
      <main className="flex-1 flex flex-col items-center justify-center my-6 sm:my-8 max-w-5xl mx-auto w-full gap-6 sm:gap-8">
        {/* Large Central Coaching Cue Card */}
        <div className="w-full max-w-3xl animate-scaleUp">
          <LiveCoachingBanner
            coachingCue={session.latestMetric ? "Active" : "Waiting"}
            depthMm={normalized.depthMm}
            rateCpm={normalized.rateCpm}
            recoilPct={normalized.recoilPct}
            flags={normalized.flags}
            handPlacement={normalized.handPlacement}
            connectionState={session.connectionState}
            sessionActive={session.active}
            compressionCount={compressionCount}
          />
        </div>

        {/* 4 simple clinical V2 metric cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 w-full mt-2">
          <MetricCard
            label="Depth"
            value={depthVal}
            unit={depthVal !== "—" ? "mm" : undefined}
            status={depthStatus}
            tone={depthTone}
            target={depthTargetStr}
            large={true}
            subtitle={
              normalized.isDerivedDepth
                ? "Depth derived from firmware depth_progress when raw mm is not supplied."
                : undefined
            }
          />
          <MetricCard
            label="Rate"
            value={rateVal}
            unit={rateVal !== "—" ? "/ min" : undefined}
            status={rateStatus}
            tone={rateTone}
            target="100–120 / min"
            large={true}
          />
          <MetricCard
            label="Recoil"
            value={recoilVal}
            unit={recoilVal.length <= 4 && normalized.recoilPct !== null ? "%" : undefined}
            status={recoilStatus}
            tone={recoilTone}
            target="≥ 90% Recoil"
            large={true}
          />
          <MetricCard
            label="Hands"
            value={handsVal}
            unit={handsUnit}
            status={handsStatus}
            tone={handsTone}
            target="Centered"
            large={true}
          />
        </div>

        {/* Live CPR Graph */}
        <div className="w-full max-w-5xl">
          <LiveCprGraph session={session} />
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center text-[10px] text-slate-400 font-bold uppercase tracking-wider pt-4 border-t border-slate-200">
        ResQ Live Telemetry Guide • Visible from distance
      </footer>
    </div>
  );
}

export default TraineeLiveSessionPage;
