import { useEffect, useState } from "react";
import { fetchSessionLive, endSession } from "../../api/sessionsApi";
import { subscribeToSessionLive } from "../../api/liveEventsClient";
import type { SessionLiveView } from "../../types/live";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";
import { MetricCard } from "../../components/cpr/MetricCard";
import { SessionTimer } from "../../components/cpr/SessionTimer";
import { normalizeTelemetry } from "../../utils/telemetryNormalization";
import LiveCprGraph from "../../components/cpr/LiveCprGraph";
import LiveCoachingBanner from "../../components/cpr/LiveCoachingBanner";

type InstructorLiveSessionPageProps = {
  sessionId: string;
  onSessionEnded: (sessionId: string) => void;
};

function getStopStatusText(lifecycleState: SessionLiveView["lifecycleState"] | null | undefined) {
  switch (lifecycleState) {
    case "STOP_PENDING":
      return "Stopping session. Waiting for firmware confirmation.";
    case "STOP_REJECTED":
      return "Stop rejected by firmware. You can retry ending the session.";
    case "STOP_TIMEOUT":
      return "Stop confirmation timed out. The session is closed locally.";
    case "INTERRUPTED":
      return "Session interrupted by firmware. Partial live state is preserved.";
    case "COMPLETED":
      return "Session completed.";
    default:
      return null;
  }
}

export function InstructorLiveSessionPage({
  sessionId,
  onSessionEnded,
}: InstructorLiveSessionPageProps) {
  const [session, setSession] = useState<SessionLiveView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [stopMessage, setStopMessage] = useState<string | null>(null);

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
            if (!stopped) {
              setSession(update);
              setStopMessage(getStopStatusText(update.lifecycleState));
              if (update.lifecycleState !== "STOP_PENDING") {
                setEnding(false);
              }
            }
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
      const response = await endSession({ sessionId });
      setStopMessage(getStopStatusText(response.state));
      setSession((current) =>
        current
          ? {
              ...current,
              active: response.active,
              lifecycleState: response.state,
              requestId: response.requestId,
            }
          : current,
      );
      if (response.state !== "STOP_PENDING") {
        setEnding(false);
      }
    } catch (err) {
      alert("Failed to end the session. Please try again.");
      setEnding(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-8 text-slate-800">
        <LoadingState message="Connecting to training session..." />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-8 text-slate-800">
        <div className="w-full max-w-lg bg-white border border-slate-200 text-center py-16 px-8 rounded-3xl space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-500 font-bold">
            !
          </div>
          <h3 className="text-lg font-bold text-slate-800">Session Unavailable</h3>
          <p className="text-sm text-slate-500 max-w-xs mx-auto leading-relaxed">{error || "Unable to load session."}</p>
          <Button type="button" className="mt-6 font-bold" onClick={() => onSessionEnded(sessionId)}>
            Return to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  const normalized = normalizeTelemetry(session);
  const lifecycleState = session.lifecycleState ?? null;
  const recoveryStatus = session.recoveryStatus ?? "NONE";
  const stopStatusText = stopMessage ?? getStopStatusText(lifecycleState);
  const recoveryStatusText =
    recoveryStatus === "PENDING"
      ? "Recovering session state..."
      : recoveryStatus === "CONFLICT"
        ? "Firmware session conflict requires attention."
        : recoveryStatus === "TIMED_OUT"
          ? "Recovery timed out. Session state is unconfirmed."
          : null;
  const canEndSession =
    recoveryStatus !== "PENDING" &&
    recoveryStatus !== "CONFLICT" &&
    lifecycleState !== "STOP_PENDING" &&
    lifecycleState !== "STOP_TIMEOUT" &&
    lifecycleState !== "INTERRUPTED";

  const profile = session.scenario && session.scenario.toLowerCase().includes("pediatric") ? "pediatric" : "adult";
  const depthTargetStr = profile === "pediatric" ? "40–50 mm" : "50–60 mm";

  // Depth card parameters
  const depthVal = normalized.depthMm !== null ? `${normalized.depthMm.toFixed(1)} mm` : "—";
  const depthTone: "good" | "warning" | "danger" | "neutral" =
    normalized.depthMm === null
      ? "neutral"
      : normalized.depthMm >= 50 && normalized.depthMm <= 60
      ? "good"
      : normalized.depthMm < 50
      ? "danger"
      : "warning";
  const depthStatus =
    normalized.depthMm === null
      ? "Waiting"
      : normalized.depthMm >= 50 && normalized.depthMm <= 60
      ? "Good"
      : normalized.depthMm < 50
      ? "Too shallow"
      : "Too deep";

  // Rate card parameters
  const rateVal = normalized.rateCpm !== null ? `${Math.round(normalized.rateCpm)} / min` : "—";
  const rateTone: "good" | "warning" | "danger" | "neutral" =
    normalized.rateCpm === null
      ? "neutral"
      : normalized.rateCpm >= 100 && normalized.rateCpm <= 120
      ? "good"
      : normalized.rateCpm < 100
      ? "danger"
      : "warning";
  const rateStatus =
    normalized.rateCpm === null
      ? "Waiting"
      : normalized.rateCpm >= 100 && normalized.rateCpm <= 120
      ? "Good"
      : normalized.rateCpm < 100
      ? "Too slow"
      : "Too fast";

  // Recoil card parameters
  let recoilVal = normalized.recoilPct !== null ? `${Math.round(normalized.recoilPct)}%` : "—";
  let recoilTone: "good" | "warning" | "danger" | "neutral" =
    normalized.recoilPct === null ? "neutral" : normalized.recoilPct >= 90 ? "good" : "danger";
  let recoilStatus =
    normalized.recoilPct === null ? "Waiting" : normalized.recoilPct >= 90 ? "Good" : "Release fully";
  if (normalized.hasRecoilCounts && normalized.recoilTotal === 0) {
    recoilVal = "Waiting for release data";
    recoilTone = "neutral";
    recoilStatus = "Waiting";
  }

  // Hand position parameters
  let handsVal = "—";
  let handsUnit = undefined;
  let placementTone: "good" | "warning" | "danger" | "neutral" = "neutral";
  let handsStatus = "Waiting";

  const cleanPlacement = (normalized.handPlacement || "").trim().toUpperCase();
  if (cleanPlacement) {
    handsStatus = cleanPlacement === "CENTER" ? "Good" : "Check Position";
    if (cleanPlacement === "CENTER") {
      handsVal = "Centered";
      placementTone = "good";
    } else if (cleanPlacement === "LEFT") {
      handsVal = "Left leaning";
      placementTone = "danger";
    } else if (cleanPlacement === "RIGHT") {
      handsVal = "Right leaning";
      placementTone = "danger";
    } else if (cleanPlacement === "NO_CONTACT") {
      handsVal = "No Contact";
      placementTone = "neutral";
    }

    if (normalized.pressureBalancePct !== null) {
      handsUnit = `(${Math.round(normalized.pressureBalancePct)}% balance)`;
    }
  } else if (normalized.pressureBalancePct !== null) {
    handsUnit = `(${Math.round(normalized.pressureBalancePct)}% balance)`;
    placementTone = session.pressureSkewed ? "danger" : "good";
    handsVal = session.pressureSkewed ? "Left leaning" : "Centered";
    handsStatus = session.pressureSkewed ? "Check Position" : "Good";
  }

  const flagSet = new Set(
    (Array.isArray(normalized.flags) ? normalized.flags : (normalized.flags || "").split(","))
      .map((f) => f.trim().toUpperCase())
      .filter(Boolean)
  );

  const compressionCount = session.latestMetric?.compressionCount ?? 0;

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800 flex flex-col font-sans select-none p-6 sm:p-8">
      {/* Live Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-5 mb-8">
        <div className="space-y-3">
          <h1 className="text-2xl font-black tracking-tight text-slate-900 leading-none">
            Live CPR Training
          </h1>
          {stopStatusText ? (
            <p className="text-xs font-bold text-amber-700">{stopStatusText}</p>
          ) : null}
          {recoveryStatusText ? (
            <p className="text-xs font-bold text-sky-700">{recoveryStatusText}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[9px] font-extrabold bg-emerald-50 text-emerald-600 border border-emerald-200 px-3 py-1 rounded-full uppercase tracking-wider block">
              ● Live
            </span>
            <span className="text-[9px] font-extrabold bg-slate-100 text-slate-600 border border-slate-200/60 px-3 py-1 rounded-full uppercase tracking-wider block font-mono">
              Device: {session.deviceId}
            </span>
            <span className="text-[9px] font-extrabold bg-sky-50 text-sky-600 border border-sky-200 px-3 py-1 rounded-full uppercase tracking-wider block">
              {profile === "pediatric" ? "Pediatric CPR" : "Adult CPR"}
            </span>
            <div className="bg-white border border-slate-200 rounded-full px-3 py-0.5 flex items-center shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
              <SessionTimer startedAt={session.startedAt} active={session.active} />
            </div>
          </div>
        </div>
        <div>
          <Button
            type="button"
            variant="danger"
            loading={ending}
            onClick={handleEndSession}
            disabled={ending || !canEndSession}
            className="shadow-sm font-bold px-6 py-2.5 text-xs rounded-xl"
          >
            {ending || lifecycleState === "STOP_PENDING" ? "Stopping..." : "End Session"}
          </Button>
        </div>
      </div>

      <div className="max-w-5xl w-full mx-auto space-y-8">
        {/* Live Coaching Banner */}
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

        {/* Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 w-full">
          <MetricCard
            label="Compression Depth"
            value={depthVal}
            status={depthStatus}
            tone={depthTone}
            target={depthTargetStr}
            large
            subtitle={
              normalized.isDerivedDepth
                ? "Depth derived from firmware depth_progress."
                : undefined
            }
          />
          <MetricCard
            label="Compression Rate"
            value={rateVal}
            status={rateStatus}
            tone={rateTone}
            target="100 - 120 / min"
            large
          />
          <MetricCard
            label="Chest Recoil"
            value={recoilVal}
            status={recoilStatus}
            tone={recoilTone}
            target="≥ 90%"
            large
          />
          <MetricCard
            label="Hand Position"
            value={handsVal}
            unit={handsUnit}
            status={handsStatus}
            tone={placementTone}
            target="Centered"
            large
          />
        </div>

        {/* Live CPR Graph */}
        <div>
          <LiveCprGraph session={session} />
        </div>

        {/* Recent flags badges */}
        <div className="bg-white border border-slate-200 p-6 rounded-2xl space-y-3 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
          <h3 className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest block border-b border-slate-100 pb-2">
            Recent Performance Flags
          </h3>
          <div className="flex flex-wrap gap-2 pt-1">
            {(() => {
              const FLAG_LABELS: Record<string, string> = {
                RATE_SLOW: "Rate slow",
                RATE_FAST: "Rate fast",
                DEPTH_LOW: "Depth shallow",
                DEPTH_HIGH: "Depth deep",
                DEPTH_OK: "Depth good",
                RATE_OK: "Rate good",
                RECOIL_OK: "Recoil good",
                HAND_LEFT: "Hand left",
                HAND_RIGHT: "Hand right",
                RECOIL_INCOMPLETE: "Incomplete recoil",
                INCOMPLETE_RECOIL: "Incomplete recoil",
                HAND_PLACEMENT_WARNING: "Leaning off-center",
              };

              const recentFlags = Array.from(flagSet);
              if (recentFlags.length === 0) {
                return (
                  <span className="text-[10px] text-slate-400 font-bold uppercase">
                    No quality flags reported
                  </span>
                );
              }
              return recentFlags.map((flag) => {
                const label = FLAG_LABELS[flag] || flag;
                const isOk = flag.endsWith("_OK");
                const isPause = flag.includes("PAUSE");
                const badgeColor = isOk
                  ? "text-emerald-700 border-emerald-200 bg-emerald-50"
                  : isPause
                  ? "text-rose-700 border-rose-200 bg-rose-50"
                  : "text-amber-700 border-amber-200 bg-amber-50";
                return (
                  <span
                    key={flag}
                    className={`text-[9px] font-extrabold px-2.5 py-1 rounded-lg border tracking-wider ${badgeColor}`}
                  >
                    {label}
                  </span>
                );
              });
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}

export default InstructorLiveSessionPage;
