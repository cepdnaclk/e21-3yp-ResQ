import { useEffect, useMemo, useState } from "react";
import { fetchCompletedSession } from "../../api/sessionsApi";
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
import { useSessionLiveStream } from "../../hooks/useSessionLiveStream";

type TraineeLiveSessionPageProps = {
  sessionId: string;
  onSessionEnded: (sessionId: string) => void;
};

export function TraineeLiveSessionPage({
  sessionId,
  onSessionEnded,
}: TraineeLiveSessionPageProps) {
  const {
    session,
    loading,
    error: streamError,
  } = useSessionLiveStream({
    sessionId,
    endBehavior: "mark-inactive",
    stopOnInactiveUpdate: true,
  });
  const [completionError, setCompletionError] = useState<string | null>(null);
  const { currentUser, logout } = useAuth();

  const [completedSession, setCompletedSession] = useState<CompletedSession | null>(null);
  const [fetchingCompleted, setFetchingCompleted] = useState(false);
  const normalized = useMemo(() => normalizeTelemetry(session), [session]);

  useEffect(() => {
    if (session && !session.active) {
      setFetchingCompleted(true);
      let cancelled = false;
      async function loadCompleted() {
        for (let attempt = 0; attempt < 8 && !cancelled; attempt += 1) {
          try {
            const data = await fetchCompletedSession(sessionId);
            if (!cancelled) {
              setCompletedSession(data);
              setCompletionError(null);
            }
            break;
          } catch (err) {
            if (attempt === 7 && !cancelled) {
              console.warn("Failed to load completed session summary", err);
              setCompletionError("Session ended, but its final score could not be loaded.");
            } else {
              await new Promise((resolve) => window.setTimeout(resolve, 250));
            }
          }
        }
        if (!cancelled) {
          setFetchingCompleted(false);
        }
      }
      loadCompleted();
      return () => {
        cancelled = true;
      };
    }
  }, [session?.active, sessionId]);

  if (loading) {
    return (
      <div className="h-screen overflow-auto bg-slate-50 flex flex-col items-center justify-center p-8 text-slate-800">
        <LoadingState message="Connecting to training session monitor..." />
      </div>
    );
  }

  if (session && !session.active && !completedSession && fetchingCompleted) {
    return (
      <div className="h-screen overflow-auto bg-slate-50 flex flex-col items-center justify-center p-8 text-slate-800">
        <LoadingState message="Processing session completion summary..." />
      </div>
    );
  }

  if (completedSession) {
    const summary = completedSession.summary;
    const score = summary.overallScore ?? summary.score;
    const scoreAvailable = summary.overallScore !== null && summary.overallScore !== undefined;
    const isExcellent = score >= 90;
    const isGood = score >= 75 && score < 90;
    const scoreClass = isExcellent
      ? "bg-emerald-50 text-emerald-600 border-emerald-200"
      : isGood
      ? "bg-amber-50 text-amber-600 border-amber-200"
      : "bg-rose-50 text-rose-600 border-rose-200";

    const hasRecoilPct = summary.recoilPct !== null && summary.recoilPct !== undefined;

    return (
      <div className="h-screen overflow-y-auto bg-[#F8FAFC] text-slate-800 flex flex-col justify-between p-6 sm:p-8 font-sans select-none animate-fadeIn">
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
                <span className="text-4xl font-black">{scoreAvailable ? `${score}%` : "—"}</span>
                <span className="text-[9px] font-extrabold uppercase tracking-wider opacity-85">Score</span>
              </div>
            </div>

            <div className="text-sm font-bold text-slate-700">
              {summary.grade ?? (scoreAvailable ? "Completed" : "Score unavailable")}
              {summary.scoreProvisional ? " · Provisional" : ""}
            </div>
            {summary.scoreCapReason && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
                Score capped at {summary.scoreCap}: {summary.scoreCapReason}
              </p>
            )}
            {summary.recommendation && (
              <p className="text-xs font-semibold text-slate-600">{summary.recommendation}</p>
            )}

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

              {summary.avgDepthMm !== null && (
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/60">
                  <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                    Avg Completed Peak Depth
                  </span>
                  <span className="text-sm text-slate-800 font-bold font-mono">
                    {summary.avgDepthMm.toFixed(1)} mm
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
                onClick={() => onSessionEnded(sessionId)}
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

  const error = completionError ?? streamError;
  if (error || !session) {
    return (
      <div className="h-screen overflow-auto bg-[#F8FAFC] flex flex-col items-center justify-center p-8 text-slate-800">
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
    const minDepth = profile === "pediatric" ? 40 : 50;
    const maxDepth = profile === "pediatric" ? 50 : 60;
    if (normalized.depthMm < minDepth) {
      depthStatus = "Too shallow";
      depthTone = "danger";
    } else if (normalized.depthMm > maxDepth) {
      depthStatus = "Too deep";
      depthTone = "warning";
    } else {
      depthStatus = "Correct depth";
      depthTone = "good";
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

    if (normalized.pressureBalanceScorePct !== null) {
      handsUnit = `(${Math.round(normalized.pressureBalanceScorePct)}% balance)`;
    }
  } else if (normalized.pressureBalanceScorePct !== null) {
    handsUnit = `(${Math.round(normalized.pressureBalanceScorePct)}% balance)`;
    handsTone = session.pressureSkewed ? "danger" : "good";
    handsVal = session.pressureSkewed ? "Left leaning" : "Centered";
    handsStatus = session.pressureSkewed ? "Check Position" : "Good";
  }

  const compressionCount = session.latestMetric?.compressionCount ?? 0;

  return (
    <div className="h-screen min-h-0 overflow-hidden bg-[#F8FAFC] text-slate-800 flex flex-col p-3 sm:p-4 font-sans select-none">
      {/* Top Header */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-3 gap-3 shrink-0">
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

        <div className="flex items-center gap-3">
          {/* Timer & Compressions Badges */}
          <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-2xl px-4 py-1 shadow-sm">
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
      <main className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden flex flex-col items-center my-3 max-w-[1500px] mx-auto w-full gap-3">
        {/* Large Central Coaching Cue Card */}
        <div className="w-full">
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
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 w-full">
          <MetricCard
            label={
              normalized.usesCompletedCompressionDepth
                ? "Avg Completed Peak Depth"
                : "Depth"
            }
            value={depthVal}
            unit={depthVal !== "—" ? "mm" : undefined}
            status={depthStatus}
            tone={depthTone}
            target={
              normalized.usesCompletedCompressionDepth
                ? `${depthTargetStr} average of completed peaks`
                : `${depthTargetStr} legacy live depth`
            }
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
        <div className="w-full flex-1 min-h-[260px]">
          <LiveCprGraph session={session} normalized={normalized} compact />
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center text-[10px] text-slate-400 font-bold uppercase tracking-wider pt-2 border-t border-slate-200 shrink-0">
        ResQ Live Telemetry Guide • Visible from distance
      </footer>
    </div>
  );
}

export default TraineeLiveSessionPage;
