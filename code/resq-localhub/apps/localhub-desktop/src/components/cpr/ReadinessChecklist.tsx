/**
 * ReadinessChecklist.tsx — Device readiness checklist shown before a session.
 * Displays in plain medical language. No firmware codes shown to instructor.
 */
import type { FirmwareReadinessResponse } from "../../types/firmware";
import type { ManikinLiveSummary } from "../../types/manikin";

type CheckItem = {
  label: string;
  pass: boolean;
  detail?: string;
};

type ReadinessChecklistProps = {
  readiness: FirmwareReadinessResponse | null;
  liveSummary?: ManikinLiveSummary | null;
  loading?: boolean;
};

export function ReadinessChecklist({ readiness, liveSummary, loading }: ReadinessChecklistProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-12 bg-slate-100 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  const online = liveSummary?.online ?? false;
  const calibrated = readiness?.calibrated ?? false;
  const ready = readiness?.ready ?? false;

  const items: CheckItem[] = [
    {
      label: "Manikin connected",
      pass: online,
      detail: online ? "Wireless link established." : "The manikin is not communicating with the hub. Check battery or range.",
    },
    {
      label: "Sensors active",
      pass: online && !liveSummary?.offline,
      detail: liveSummary?.offline ? "Telemetry stream stopped." : "Sensor board online.",
    },
    {
      label: "Readiness check complete",
      pass: calibrated,
      detail: calibrated ? "Device calibrated." : "Run a readiness check before starting a session to establish sensor baseline.",
    },
    {
      label: "Signal quality",
      pass: online && !liveSummary?.stale,
      detail: liveSummary?.stale ? "Signal is intermittent. Keep device closer to hub." : "Stable local wireless connection.",
    },
    {
      label: "System ready",
      pass: ready && online,
      detail: ready && online ? "Ready for clinical training." : "The device has pending errors and is not ready.",
    },
  ];

  const allPass = items.every((i) => i.pass);

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div
          key={item.label}
          className={`flex items-start gap-3.5 p-4 rounded-xl border transition-all duration-300 ${
            item.pass
              ? "bg-emerald-50/40 border-emerald-100/60"
              : "bg-rose-50/40 border-rose-100/60"
          }`}
        >
          <div
            className={`mt-0.5 w-6 h-6 rounded-full shrink-0 flex items-center justify-center transition-colors ${
              item.pass ? "bg-emerald-500 text-white" : "bg-rose-500 text-white"
            }`}
          >
            {item.pass ? (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            )}
          </div>
          <div className="space-y-0.5">
            <div className={`text-sm font-bold tracking-tight ${item.pass ? "text-emerald-800" : "text-rose-800"}`}>
              {item.label}
            </div>
            {item.detail && (
              <div className="text-xs text-slate-400 font-normal leading-relaxed">{item.detail}</div>
            )}
          </div>
        </div>
      ))}

      {allPass && (
        <div className="mt-5 p-5 rounded-2xl bg-emerald-50 border border-emerald-100 text-center space-y-1 shadow-sm shadow-emerald-500/5">
          <div className="text-base font-extrabold text-emerald-800 flex items-center justify-center gap-1.5 leading-none">
            <span>✓</span> Device Fully Ready
          </div>
          <div className="text-xs text-emerald-600 font-medium leading-relaxed">
            All connection checks passed. You can start clinical training now.
          </div>
        </div>
      )}
    </div>
  );
}

export default ReadinessChecklist;
