interface LiveCoachingBannerProps {
  coachingCue: string;
  depthMm: number | null;
  rateCpm: number | null;
  recoilPct: number | null;
  flags: string | string[] | null;
  handPlacement: string | null;
  connectionState: string | null;
  sessionActive: boolean | null;
  compressionCount: number;
}

export function LiveCoachingBanner({
  coachingCue,
  depthMm,
  rateCpm,
  recoilPct,
  flags,
  handPlacement,
  connectionState,
  sessionActive,
  compressionCount,
}: LiveCoachingBannerProps) {
  const flagSet = new Set(
    (Array.isArray(flags) ? flags : (flags || "").split(","))
      .map((f) => f.trim().toUpperCase())
  );

  let title = "Waiting for compressions…";
  let explanation = "Start compressions to see live sensor guidance.";
  let severity: "success" | "warning" | "danger" | "info" = "info";

  const isOffline = connectionState === "OFFLINE" || connectionState === "STALE" || connectionState === "ERROR";

  if (isOffline) {
    title = "Waiting for signal…";
    explanation = "Telemetry stream is establishing connection. Place hands on the chest.";
    severity = "info";
  } else if (sessionActive === false) {
    title = "Session ended";
    explanation = "The CPR training session has concluded.";
    severity = "info";
  } else if (compressionCount === 0) {
    title = "Waiting for compressions…";
    explanation = "Start compressions to see live sensor guidance.";
    severity = "info";
  } else {
    // 1. Pause detected
    if (flagSet.has("PAUSE_DETECTED")) {
      title = "Keep going — avoid pauses";
      explanation = "Continuous chest compressions are required to maintain blood flow to vital organs.";
      severity = "danger";
    }
    // 2. Extremely shallow and slow
    else if (depthMm !== null && depthMm < 50 && rateCpm !== null && rateCpm < 100) {
      title = "Press deeper and increase rate";
      explanation = "Depth is below the 50–60 mm target and rate is below 100–120/min.";
      severity = "danger";
    }
    // 3. Too shallow
    else if (depthMm !== null && depthMm < 50) {
      title = "Press deeper";
      explanation = "Depth is below the 50–60 mm target. Increase compression force.";
      severity = "danger";
    }
    // 4. Incomplete recoil
    else if (recoilPct !== null && recoilPct < 90) {
      title = "Release fully between compressions";
      explanation = "Chest recoil is below the 90% target. Allow full re-expansion.";
      severity = "danger";
    }
    // 5. Too slow
    else if (rateCpm !== null && rateCpm < 100) {
      title = "Speed up slightly";
      explanation = "Rate is below the 100–120/min target. Increase rhythm speed.";
      severity = "warning";
    }
    // 6. Too fast
    else if (rateCpm !== null && rateCpm > 120) {
      title = "Slow down rate";
      explanation = "Rate is above the 100–120/min target. Decrease rhythm speed.";
      severity = "warning";
    }
    // 7. Too deep
    else if (depthMm !== null && depthMm > 60) {
      title = "Press lighter";
      explanation = "Depth is above the 50–60 mm target. Reduce compression force.";
      severity = "warning";
    }
    // 8. Incorrect hand placement
    else if (flagSet.has("HAND_PLACEMENT_WARNING") || (handPlacement && handPlacement !== "CENTER" && handPlacement !== "NO_CONTACT")) {
      title = "Check hand position";
      explanation = "Hands are leaning off-center. Place in center of chest.";
      severity = "warning";
    }
    // 9. Good compressions
    else {
      title = "Good compressions — keep it up!";
      explanation = "Depth, rate, and chest recoil are within target range.";
      severity = "success";
    }
  }

  // Accent mapping classes for light theme card
  const accentClasses = {
    success: {
      border: "border-l-[#22C55E]",
      bg: "bg-[#22C55E]/5",
      textColor: "text-emerald-800",
      badgeColor: "bg-emerald-100 text-emerald-800",
      icon: "✓",
    },
    warning: {
      border: "border-l-[#F59E0B]",
      bg: "bg-[#F59E0B]/5",
      textColor: "text-amber-800",
      badgeColor: "bg-amber-100 text-amber-800",
      icon: "⚠",
    },
    danger: {
      border: "border-l-[#EF4444]",
      bg: "bg-[#EF4444]/5",
      textColor: "text-rose-800",
      badgeColor: "bg-rose-100 text-rose-850",
      icon: "🚨",
    },
    info: {
      border: "border-l-slate-400",
      bg: "bg-slate-50",
      textColor: "text-slate-700",
      badgeColor: "bg-slate-200 text-slate-700",
      icon: "ℹ",
    },
  }[severity];

  return (
    <div
      className={`rounded-2xl border border-slate-200 border-l-8 ${accentClasses.border} ${accentClasses.bg} p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-all duration-300 shadow-sm`}
    >
      <div className="flex items-start gap-4">
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-base border border-slate-200/50 shadow-sm ${accentClasses.badgeColor}`}
        >
          {accentClasses.icon}
        </div>
        <div className="space-y-1">
          <h2 className={`text-base font-black tracking-tight leading-tight ${accentClasses.textColor}`}>
            {title}
          </h2>
          <p className="text-xs text-slate-500 font-semibold leading-relaxed">
            {explanation}
          </p>
        </div>
      </div>
    </div>
  );
}

export default LiveCoachingBanner;
