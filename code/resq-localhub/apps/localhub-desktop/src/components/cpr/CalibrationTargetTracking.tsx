import Card from "../ui/Card";
import type { SensorStreamCommandUpdate, SensorStreamUiState } from "../../lib/sensorStreamTypes";
import type { CalibrationTargetDisplay } from "../../utils/calibrationTargetTracking";

type Props = {
  targets: CalibrationTargetDisplay[];
  streamState: SensorStreamUiState | "CALIBRATION_OWNED";
  streamReasonId: string | null;
  commandUpdate: SensorStreamCommandUpdate | null;
  stale: boolean;
  lastUpdatedAt: string | null;
  guidanceAnnouncement: string;
};

const STATUS_STYLES: Record<CalibrationTargetDisplay["status"], string> = {
  PENDING: "bg-slate-100 text-slate-600",
  ACTIVE: "bg-blue-100 text-blue-700",
  BELOW_TARGET: "bg-blue-100 text-blue-700",
  NEAR_TARGET: "bg-amber-100 text-amber-700",
  REACHED: "bg-emerald-100 text-emerald-700",
  ABOVE_TARGET: "bg-amber-100 text-amber-700",
  INVALID: "bg-rose-100 text-rose-700",
  COMPLETED: "bg-emerald-100 text-emerald-700",
  FAILED: "bg-rose-100 text-rose-700",
};

export default function CalibrationTargetTracking({
  targets,
  streamState,
  streamReasonId,
  commandUpdate,
  stale,
  lastUpdatedAt,
  guidanceAnnouncement,
}: Props) {
  const stateText = stale ? "STALE" : streamState;
  return (
    <Card className="border border-slate-100 shadow-[0_4px_12px_rgba(0,0,0,0.02)] p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between mb-4">
        <div>
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Calibration Target Tracking</h4>
          <p className="mt-1 text-xs text-slate-400">
            {streamState === "IDLE" && "Preparing live sensor stream…"}
            {streamState === "STARTING" && "Starting sensor stream…"}
            {streamState === "RUNNING" && !stale && "Live SENSOR_STREAM raw samples"}
            {streamState === "CALIBRATION_OWNED" && "Calibration-owned raw samples (manual stream paused by firmware)"}
            {streamState === "STOPPING" && "Stopping sensor stream…"}
            {streamState === "ERROR" && `Sensor stream unavailable${streamReasonId ? ` — reason ${streamReasonId}` : ""}`}
            {stale && "Waiting for a fresh sensor sample"}
          </p>
        </div>
        <span className={`w-fit rounded-full px-2.5 py-1 text-[10px] font-extrabold ${stale ? "bg-slate-100 text-slate-500" : streamState === "ERROR" ? "bg-rose-100 text-rose-700" : "bg-blue-50 text-blue-700"}`}>
          {stateText}
        </span>
      </div>

      {streamState === "ERROR" && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800" role="alert">
          <p className="font-extrabold">Manual sensor stream command was rejected or could not be sent.</p>
          <dl className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-3">
            <Detail label="Action" value={commandUpdate?.action ?? "START"} />
            <Detail label="Reason ID" value={commandUpdate?.reasonId ?? streamReasonId ?? "Unavailable"} />
            <Detail label="Firmware state" value={commandUpdate?.firmwareState ?? "Unavailable"} />
          </dl>
          <p className="mt-2">Calibration-owned samples will be used if calibration is active. Otherwise, check device state before retrying; the page will not automatically repeat START.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {targets.map((target) => {
          const visualProgress = target.progressPercent === null ? 0 : Math.min(120, Math.max(0, target.progressPercent));
          return (
            <section
              key={target.id}
              aria-label={`${target.label} target status`}
              className={`min-w-0 rounded-xl border p-4 ${target.active ? "border-blue-300 bg-blue-50/40 ring-2 ring-blue-100" : target.status === "FAILED" ? "border-rose-200 bg-rose-50/40" : "border-slate-100 bg-slate-50/60"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h5 className="text-sm font-extrabold text-slate-800">{target.label}</h5>
                  {target.active && <span className="text-[10px] font-bold uppercase tracking-wide text-blue-600">Current stage</span>}
                </div>
                <span className={`rounded-full px-2 py-1 text-[9px] font-extrabold ${STATUS_STYLES[target.status]}`}>
                  {target.status.replace(/_/g, " ")}
                </span>
              </div>

              <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <Metric label="Target" value={target.targetLabel ?? formatValue(target.targetValue, target.unit)} />
                <Metric label="Current" value={formatValue(target.currentValue, target.unit)} />
                <Metric label="Difference" value={formatDifference(target.difference, target.unit)} />
              </dl>

              {target.progressPercent !== null && (
                <div className="mt-3">
                  <div className="flex justify-between text-[10px] font-semibold text-slate-500">
                    <span>Progress</span><span>{target.progressPercent.toFixed(1)}%</span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label={`${target.label} progress`}
                    aria-valuemin={0}
                    aria-valuemax={120}
                    aria-valuenow={Math.round(visualProgress)}
                    className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200"
                  >
                    <div className={`h-full rounded-full ${target.reached ? "bg-emerald-500" : target.status === "NEAR_TARGET" ? "bg-amber-500" : "bg-blue-500"}`} style={{ width: `${visualProgress / 1.2}%` }} />
                  </div>
                </div>
              )}

              {target.id === "full" && (
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-white/70 p-2 text-[10px] text-slate-600">
                  <Detail label="Hall raw" value={numberOrUnavailable(target.currentHallRaw)} />
                  <Detail label="Baseline" value={numberOrUnavailable(target.capturedHallBaseline)} />
                  <Detail label="Current delta" value={numberOrUnavailable(target.currentHallDelta)} />
                  <Detail label="Target delta" value={numberOrUnavailable(target.targetHallDelta)} />
                  {target.status === "FAILED" && <Detail label="Maximum delta" value={numberOrUnavailable(target.maximumHallDelta ?? target.currentHallDelta)} />}
                  <Detail label={target.depthEstimated ? "Estimated during calibration" : "Current depth"} value={target.currentDepthMm == null ? "Unavailable" : `${target.currentDepthMm.toFixed(1)} mm`} />
                  <Detail label="Target depth" value={target.targetDepthMm == null ? "N/A" : `${target.targetDepthMm.toFixed(1)} mm`} />
                  {target.status === "FAILED" && target.currentDepthMm != null && target.targetDepthMm != null && (
                    <Detail label="Estimated remaining depth" value={`${Math.max(0, target.targetDepthMm - target.currentDepthMm).toFixed(1)} mm`} />
                  )}
                </dl>
              )}

              <p className="mt-3 text-xs font-semibold text-slate-600">{target.guidance}</p>
              <p className="mt-1 text-[10px] text-slate-400">{target.reached ? "Reached" : "Not reached"}</p>
            </section>
          );
        })}
      </div>

      <div className="mt-3 text-[10px] text-slate-400">
        {lastUpdatedAt ? `Last sample: ${new Date(lastUpdatedAt).toLocaleTimeString()}` : "No sensor sample received yet"}
        <span className="ml-2">UI proximity uses a 2% display tolerance; firmware remains authoritative for pass/fail.</span>
      </div>
      <div aria-live="polite" aria-atomic="true" className="sr-only">{guidanceAnnouncement}</div>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{label}</dt><dd className="mt-0.5 break-words font-bold text-slate-700">{value}</dd></div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-2"><dt>{label}</dt><dd className="font-bold text-slate-700">{value}</dd></div>;
}

function formatValue(value: number | null, unit: string): string {
  return value === null ? "Unavailable" : `${Math.round(value).toLocaleString()} ${unit}`;
}

function formatDifference(value: number | null, unit: string): string {
  if (value === null) return "N/A";
  const sign = value > 0 ? "+" : "";
  return `${sign}${Math.round(value).toLocaleString()} ${unit}`;
}

function numberOrUnavailable(value: number | null | undefined): string {
  return value == null ? "Unavailable" : Math.round(value).toLocaleString();
}
