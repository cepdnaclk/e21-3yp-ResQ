import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
} from "recharts";
import type { SessionLiveView } from "../../types/live";
import Card from "../ui/Card";
import { useRollingTelemetry } from "../../hooks/useRollingTelemetry";
import { normalizeTelemetry } from "../../utils/telemetryNormalization";

export function LiveCprGraph({ session }: { session: SessionLiveView | null }) {
  const data = useRollingTelemetry(session);
  const online = session?.online && !session?.offline && !session?.stale;

  const normalized = normalizeTelemetry(session);

  if (data.length === 0) {
    return (
      <Card className="p-6 h-[320px] flex flex-col items-center justify-center border border-slate-200 bg-white text-slate-400 select-none animate-fadeIn">
        <span className="text-3xl mb-3 animate-pulse">📊</span>
        <p className="text-sm font-semibold tracking-wide text-slate-700">Waiting for compression data...</p>
        <p className="text-xs text-slate-400 mt-1 font-semibold">Waveform stream will render on the next chest compression.</p>
      </Card>
    );
  }

  return (
    <Card className="p-6 border border-slate-200 bg-white select-none animate-fadeIn">
      <div className="flex justify-between items-start mb-6">
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

      <div className="h-[240px] w-full text-slate-350">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 15, right: 10, left: -25, bottom: 5 }}>
            <defs>
              <linearGradient id="depthColor" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#0284c7" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#0284c7" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="time" stroke="#94a3b8" style={{ fontSize: "8px", fontWeight: 700 }} />
            <YAxis stroke="#94a3b8" style={{ fontSize: "8px", fontWeight: 700 }} domain={[0, 70]} />
            <Tooltip
              contentStyle={{
                background: "#ffffff",
                borderColor: "#e2e8f0",
                borderRadius: "12px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.04)",
              }}
              labelClassName="text-slate-400 text-[10px] font-bold"
              itemStyle={{ fontSize: "11px", fontWeight: "bold", color: "#1e293b" }}
            />

            {/* Target Area and Lines for Depth (50-60mm) */}
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

            {/* 0mm Baseline */}
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

            <Area
              type="monotone"
              dataKey="depthMm"
              stroke="#0284c7"
              strokeWidth={2.5}
              fillOpacity={1}
              fill="url(#depthColor)"
              name="Depth (mm)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Summary Chips below graph */}
      <div className="flex flex-wrap items-center gap-4 mt-6 border-t border-slate-100 pt-4 text-xs font-semibold text-slate-500">
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
              if (session && session.pressureBalancePct !== null) {
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
