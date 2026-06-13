/**
 * CompressionQualitySummary.tsx — Summary of a completed session's metrics.
 * Used on SessionReviewPage. Friendly labels, no raw values.
 */
import { formatDepth, formatDuration, formatRate, formatRecoilPct, getScoreLabel, getScoreTone } from "../../utils/userFriendlyLabels";
import type { SessionSummary } from "../../types/session";

type CompressionQualitySummaryProps = {
  summary: SessionSummary;
};

export function CompressionQualitySummary({ summary }: CompressionQualitySummaryProps) {
  const scoreTone = getScoreTone(summary.score);
  const scoreLabel = getScoreLabel(summary.score);

  const scoreColor = {
    excellent: "text-green-600 bg-green-50 border-green-200",
    good:      "text-blue-600 bg-blue-50 border-blue-200",
    fair:      "text-yellow-700 bg-yellow-50 border-yellow-200",
    poor:      "text-red-600 bg-red-50 border-red-200",
  }[scoreTone];

  return (
    <div className="space-y-5">
      {/* Score */}
      <div className={`rounded-2xl border-2 p-6 text-center ${scoreColor}`}>
        <div className="text-6xl font-black">{summary.score}</div>
        <div className="text-lg font-semibold mt-1">{scoreLabel}</div>
        <div className="text-sm text-gray-500 mt-0.5">out of 100</div>
      </div>

      {/* Key metrics grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Stat label="Duration" value={formatDuration(summary.durationSeconds)} />
        <Stat label="Compressions" value={String(summary.totalCompressions)} />
        <Stat label="Valid compressions" value={String(summary.validCompressions)} />
        <Stat label="Avg depth" value={formatDepth(summary.avgDepthMm)} note="Target: ~50 mm" />
        <Stat label="Avg rate" value={formatRate(summary.avgRateCpm)} note="Target: ~110 / min" />
        <Stat label="Recoil success" value={formatRecoilPct(summary.recoilPct)} note="Target: >90%" />
        <Stat label="Pauses" value={String(summary.pausesCount)} note="Fewer is better" />
      </div>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
      <div className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</div>
      <div className="text-xl font-bold text-gray-900 mt-0.5">{value}</div>
      {note && <div className="text-xs text-gray-400 mt-0.5">{note}</div>}
    </div>
  );
}
