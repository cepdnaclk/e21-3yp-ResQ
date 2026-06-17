import { useState } from "react";
import { getFriendlyReason, getFriendlyAction } from "../../utils/readinessState";

type CalibrationResultCardProps = {
  reasonId: string | null | undefined;
  actionId: number | null | undefined;
  lastErrorId?: string | null;
  onRetry: () => void;
  onRequestDebug: () => void;
  debugLoading?: boolean;
};

export function CalibrationResultCard({
  reasonId,
  actionId,
  lastErrorId,
  onRetry,
  onRequestDebug,
  debugLoading,
}: CalibrationResultCardProps) {
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const friendlyReason = getFriendlyReason(reasonId);
  const friendlyAction = getFriendlyAction(actionId);

  return (
    <div className="bg-rose-50/50 border border-rose-100 rounded-2xl p-6 space-y-4 text-left animate-fadeIn">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center text-rose-700 font-extrabold text-sm shrink-0">
          ⚠
        </div>
        <div>
          <h4 className="text-sm font-black text-rose-900">Pre-Check Failed</h4>
          <p className="text-xs text-rose-700 mt-1 font-semibold leading-relaxed">
            {friendlyReason}
          </p>
          <p className="text-xs text-slate-500 mt-2 font-medium leading-relaxed">
            <span className="font-bold text-slate-600">Recommended Action: </span>
            {friendlyAction}
          </p>
        </div>
      </div>

      {/* Buttons */}
      <div className="flex flex-wrap gap-2.5 pt-2 border-t border-rose-100/50">
        <button
          type="button"
          onClick={onRetry}
          className="px-4 py-2 bg-rose-600 hover:bg-rose-700 transition-colors text-white font-bold text-xs rounded-xl shadow-sm cursor-pointer"
        >
          Retry Calibration
        </button>
        <button
          type="button"
          onClick={onRequestDebug}
          disabled={debugLoading}
          className="px-4 py-2 bg-white hover:bg-slate-50 border border-slate-200 transition-colors text-slate-700 font-bold text-xs rounded-xl shadow-sm cursor-pointer disabled:opacity-50"
        >
          {debugLoading ? "Requesting..." : "Request Debug Snapshot"}
        </button>
      </div>

      {/* Collapsible Diagnostics Section */}
      <div className="border-t border-rose-100/50 pt-3">
        <button
          type="button"
          onClick={() => setShowDiagnostics(!showDiagnostics)}
          className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 hover:text-slate-500 transition-colors cursor-pointer uppercase tracking-wider"
        >
          <svg
            className={`w-3 h-3 transform transition-transform ${showDiagnostics ? "rotate-90" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
          {showDiagnostics ? "Hide raw diagnostic values" : "Show raw diagnostic values"}
        </button>

        {showDiagnostics && (
          <div className="mt-3 bg-slate-900 text-slate-300 p-4 rounded-xl font-mono text-[10px] space-y-1 select-text overflow-x-auto leading-relaxed border border-slate-950">
            <div>deviceId_diagnostics_bundle:</div>
            <div className="text-teal-400">  reason_id: "{reasonId || "null"}"</div>
            <div className="text-teal-400">  action_id: {actionId !== null && actionId !== undefined ? actionId : "null"}</div>
            {lastErrorId && (
              <div className="text-rose-400">  last_error_id: "{lastErrorId}"</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
export default CalibrationResultCard;
