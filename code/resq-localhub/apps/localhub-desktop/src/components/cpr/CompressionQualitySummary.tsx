/**
 * CompressionQualitySummary.tsx — Summary of a completed session's metrics.
 * Used on SessionReviewPage. Friendly labels, no raw values.
 */
import { formatDepth, formatDuration, formatRate, formatRecoilPct } from "../../utils/userFriendlyLabels";
import type { SessionSummary } from "../../types/session";

type CompressionQualitySummaryProps = {
  summary: SessionSummary;
};

export function CompressionQualitySummary({ summary }: CompressionQualitySummaryProps) {
  // Calculate simple percentage guidelines for progress bars
  const avgDepth = summary.avgDepthMm || 0;
  const avgRate = summary.avgRateCpm || 0;
  const recoilPct = summary.recoilPct || 0;

  // Depth percentage accuracy (target ~50mm, max 60mm)
  const depthAccuracy = Math.min(100, Math.round((avgDepth / 55) * 100));
  // Rate accuracy (target 100-120 cpm, centered around 110)
  const rateAccuracy = Math.min(100, Math.round((avgRate / 110) * 100));

  return (
    <div className="space-y-6">
      {/* Target Progress Bars */}
      <div className="space-y-4 bg-slate-50 p-5 rounded-2xl border border-slate-100/40">
        <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Target Accuracy Summary</h4>
        
        {/* Depth Bar */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs font-bold text-slate-700">
            <span>Average Depth Accuracy</span>
            <span>{formatDepth(avgDepth)}</span>
          </div>
          <div className="w-full bg-slate-200/70 h-2 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                avgDepth >= 45 && avgDepth <= 55 ? "bg-emerald-500" : "bg-amber-500"
              }`}
              style={{ width: `${depthAccuracy}%` }}
            />
          </div>
        </div>

        {/* Rate Bar */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs font-bold text-slate-700">
            <span>Average Rhythm Speed</span>
            <span>{formatRate(avgRate)}</span>
          </div>
          <div className="w-full bg-slate-200/70 h-2 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                avgRate >= 100 && avgRate <= 120 ? "bg-emerald-500" : "bg-amber-500"
              }`}
              style={{ width: `${rateAccuracy}%` }}
            />
          </div>
        </div>

        {/* Recoil Bar */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs font-bold text-slate-700">
            <span>Full Chest Release</span>
            <span>{formatRecoilPct(recoilPct)}</span>
          </div>
          <div className="w-full bg-slate-200/70 h-2 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                recoilPct >= 90 ? "bg-emerald-500" : "bg-amber-500"
              }`}
              style={{ width: `${recoilPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Key metrics grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Stat label="Total Duration" value={formatDuration(summary.durationSeconds)} />
        <Stat label="Total Compressions" value={String(summary.totalCompressions)} />
        <Stat label="Valid Compressions" value={String(summary.validCompressions)} />
        <Stat label="Average Depth" value={formatDepth(summary.avgDepthMm)} note="Target: 50.0 - 60.0 mm" />
        <Stat label="Average Rate" value={formatRate(summary.avgRateCpm)} note="Target: 100 - 120 / min" />
        <Stat label="Pauses Detected" value={String(summary.pausesCount)} note="Target: 0 pauses" />
      </div>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="bg-slate-50/50 rounded-xl p-4 border border-slate-100/40 space-y-0.5">
      <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{label}</div>
      <div className="text-lg font-black text-slate-800 tracking-tight font-mono">{value}</div>
      {note && <div className="text-[10px] text-slate-400 font-semibold">{note}</div>}
    </div>
  );
}
