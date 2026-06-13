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
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />
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
      detail: online ? undefined : "The manikin is not communicating with the hub.",
    },
    {
      label: "Sensors active",
      pass: online && !liveSummary?.offline,
      detail: liveSummary?.offline ? "The device has gone offline." : undefined,
    },
    {
      label: "Readiness check complete",
      pass: calibrated,
      detail: calibrated ? undefined : "Run a readiness check before starting a session.",
    },
    {
      label: "Signal quality",
      pass: online && !liveSummary?.stale,
      detail: liveSummary?.stale ? "Signal is intermittent." : undefined,
    },
    {
      label: "System ready",
      pass: ready && online,
      detail: ready && online ? undefined : "The device is not ready for a session.",
    },
  ];

  const allPass = items.every((i) => i.pass);

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div
          key={item.label}
          className={`flex items-start gap-3 p-3 rounded-lg border ${
            item.pass
              ? "bg-green-50 border-green-200"
              : "bg-red-50 border-red-200"
          }`}
        >
          <div
            className={`mt-0.5 w-5 h-5 rounded-full shrink-0 flex items-center justify-center ${
              item.pass ? "bg-green-500" : "bg-red-400"
            }`}
          >
            {item.pass ? (
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            ) : (
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            )}
          </div>
          <div>
            <div className={`text-sm font-medium ${item.pass ? "text-green-800" : "text-red-800"}`}>
              {item.label}
            </div>
            {item.detail && (
              <div className="text-xs text-gray-600 mt-0.5">{item.detail}</div>
            )}
          </div>
        </div>
      ))}

      {allPass && (
        <div className="mt-4 p-4 rounded-xl bg-green-100 border-2 border-green-300 text-center">
          <div className="text-lg font-bold text-green-800">✓ Device ready</div>
          <div className="text-sm text-green-700 mt-0.5">
            All checks passed. You can start a session now.
          </div>
        </div>
      )}
    </div>
  );
}
