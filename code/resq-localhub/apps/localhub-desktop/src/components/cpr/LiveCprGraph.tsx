import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
} from "recharts";
import { memo } from "react";
import type { SessionLiveView } from "../../types/live";
import Card from "../ui/Card";
import { useRollingTelemetry } from "../../hooks/useRollingTelemetry";
import type { NormalizedTelemetry } from "../../utils/telemetryNormalization";

type LiveCprGraphProps = {
  session: SessionLiveView;
  normalized: NormalizedTelemetry;
  compact?: boolean;
};

const WaveformPlot = memo(function WaveformPlot({
  data,
}: {
  data: ReturnType<typeof useRollingTelemetry>;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 15, right: 10, left: -25, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="time" stroke="#94a3b8" style={{ fontSize: "8px", fontWeight: 700 }} />
        <YAxis stroke="#94a3b8" style={{ fontSize: "8px", fontWeight: 700 }} domain={[0, 70]} />
        <ReferenceArea y1={50} y2={60} fill="#0284c7" fillOpacity={0.06} />
        <ReferenceLine
          y={50}
          stroke="#0284c7"
          strokeOpacity={0.3}
          strokeDasharray="3 3"
          label={{
            value: "Target Min (50mm)",
            fill: "#0284c7",
            fontSize: 8,
            position: "insideBottomLeft",
            fontWeight: 700,
          }}
        />
        <ReferenceLine
          y={60}
          stroke="#0284c7"
          strokeOpacity={0.3}
          strokeDasharray="3 3"
          label={{
            value: "Target Max (60mm)",
            fill: "#0284c7",
            fontSize: 8,
            position: "insideTopLeft",
            fontWeight: 700,
          }}
        />
        <ReferenceLine
          y={0}
          stroke="#94a3b8"
          strokeWidth={1}
          label={{
            value: "Baseline (0mm)",
            fill: "#64748b",
            fontSize: 8,
            position: "insideBottomRight",
            fontWeight: 700,
          }}
        />
        <Line
          type="linear"
          dataKey="depthMm"
          stroke="#0284c7"
          strokeWidth={2.5}
          dot={false}
          activeDot={false}
          name="Depth (mm)"
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
});

export function LiveCprGraph({
  session,
  normalized,
  compact = false,
}: LiveCprGraphProps) {
  const data = useRollingTelemetry({
    sessionId: session.sessionId,
    active: session.active,
    metric: session.latestMetric,
    normalized,
  });
  const online = session?.online && !session?.offline && !session?.stale;

  if (data.length === 0) {
    return (
      <Card className={`${compact ? "h-full min-h-56 p-4" : "h-[320px] p-6"} flex flex-col items-center justify-center border border-slate-200 bg-white text-slate-400 select-none`}>
        <span className="text-3xl mb-3 animate-pulse">📊</span>
        <p className="text-sm font-semibold tracking-wide text-slate-700">Waiting for compression data...</p>
        <p className="text-xs text-slate-400 mt-1 font-semibold">Waveform stream will render on the next chest compression.</p>
      </Card>
    );
  }

  return (
    <Card className={`${compact ? "h-full p-4" : "p-6"} border border-slate-200 bg-white select-none`}>
      <div className={`flex justify-between items-start ${compact ? "mb-3" : "mb-6"}`}>
        <div>
          <h2 className="text-sm font-black text-slate-800 tracking-tight leading-tight">
            Compression Depth Waveform
          </h2>
          <p className="text-[9px] text-slate-400 font-extrabold uppercase tracking-wider mt-1">
            Real-time depth readings (mm)
          </p>
        </div>
        {!online ? (
          <span className="text-[9px] font-extrabold bg-rose-50 text-rose-600 border border-rose-100 px-2.5 py-0.5 rounded-full uppercase tracking-wider animate-pulse">
            Connection Stale
          </span>
        ) : (
          <span className="text-[9px] font-extrabold bg-emerald-50 text-emerald-600 border border-emerald-100 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
            Live Waveform
          </span>
        )}
      </div>

      <div
        role="img"
        aria-label={`Compression depth waveform with ${data.length} samples from the last minute`}
        className={`${compact ? "h-[clamp(150px,24vh,220px)]" : "h-[240px]"} w-full text-slate-350`}
      >
        <WaveformPlot data={data} />
      </div>

      {/* Summary Chips below graph */}
      <div className={`flex flex-wrap items-center ${compact ? "gap-2 mt-3 pt-3" : "gap-4 mt-6 pt-4"} border-t border-slate-100 text-xs font-semibold text-slate-500`}>
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Current Metrics:</span>
        <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200/60 px-3 py-1.5 rounded-xl">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          <span className="text-slate-700 font-extrabold">Rate:</span>
          <span className="text-slate-600 font-bold font-mono">
            {normalized.rateCpm !== null ? `${Math.round(normalized.rateCpm)} CPM` : "—"}
          </span>
        </div>
        <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200/60 px-3 py-1.5 rounded-xl">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span className="text-slate-700 font-extrabold">Recoil:</span>
          <span className="text-slate-600 font-bold font-mono">
            {normalized.hasRecoilCounts && normalized.recoilTotal === 0
              ? "Waiting"
              : normalized.recoilPct !== null
              ? `${Math.round(normalized.recoilPct)}%`
              : "—"}
          </span>
        </div>
        <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200/60 px-3 py-1.5 rounded-xl">
          <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
          <span className="text-slate-700 font-extrabold">Hand Position:</span>
          <span className="text-slate-600 font-bold">
            {(() => {
              if (normalized.handPlacement === "CENTER") return "Centered";
              if (normalized.handPlacement === "LEFT") return "Left Leaning";
              if (normalized.handPlacement === "RIGHT") return "Right Leaning";
              if (normalized.handPlacement === "NO_CONTACT") return "No Contact";
              if (session && session.pressureBalanceScorePct !== null) {
                return session.pressureSkewed ? "Leaning" : "Centered";
              }
              return "—";
            })()}
          </span>
        </div>
      </div>

      {normalized.isDerivedDepth && (
        <p className="text-[9px] text-slate-400 font-semibold mt-3 italic">
          * Depth derived from firmware depth_progress.
        </p>
      )}
    </Card>
  );
}

export default LiveCprGraph;
