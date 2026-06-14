import type { ManikinLiveSummary } from "../../types/manikin";
import Card from "../ui/Card";
import Button from "../ui/Button";
import StatusBadge from "../ui/StatusBadge";
import {
  getDeviceStateLabel,
  getDeviceStateTone,
  isDeviceReady,
  isSessionActive,
} from "../../utils/userFriendlyLabels";

type DeviceCardProps = {
  manikin: ManikinLiveSummary;
  onRunReadinessCheck: (deviceId: string) => void;
  onOpenStartModal: (deviceId: string) => void;
  onViewSession: (sessionId: string) => void;
};

export function DeviceCard({
  manikin,
  onRunReadinessCheck,
  onOpenStartModal,
  onViewSession,
}: DeviceCardProps) {
  const isOnline = manikin.online && !manikin.offline;
  const isReadyDevice = isDeviceReady(manikin.state, manikin.online, manikin.stale, manikin.offline);
  const isActive = isSessionActive(manikin.state, manikin.sessionActive);
  const displayState = isOnline ? (isActive ? "SESSION_ACTIVE" : manikin.state) : "offline";

  // Friendly description sentence
  let statusMessage = "Device is offline. Turn on manikin power to connect.";
  if (isOnline) {
    if (isActive) {
      statusMessage = "Live training session is currently active and recording telemetry.";
    } else if (isReadyDevice) {
      statusMessage = "All systems active. Manikin is ready for a training session.";
    } else {
      statusMessage = "Readiness check or calibration required before starting training.";
    }
  }

  return (
    <Card className="flex flex-col justify-between hover:border-slate-300 hover:shadow-[0_12px_24px_rgba(15,23,42,0.06)] hover:-translate-y-0.5 transition-all duration-300">
      <div>
        <div className="flex justify-between items-start mb-4">
          <div className="flex flex-col">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-0.5">Manikin ID</span>
            <span className="font-bold text-slate-800 font-mono tracking-tight text-lg">{manikin.deviceId}</span>
          </div>
          <StatusBadge
            tone={getDeviceStateTone(displayState)}
            label={getDeviceStateLabel(displayState)}
          />
        </div>

        <p className="text-xs text-slate-400 leading-relaxed font-normal min-h-[36px]">
          {statusMessage}
        </p>

        {isOnline && (
          <div className="mt-3 pt-3 border-t border-slate-100/60 flex items-center justify-between text-xs font-medium text-slate-400">
            <span>Signal Status:</span>
            <span className={manikin.stale ? "text-amber-600 font-bold" : "text-emerald-600 font-bold"}>
              {manikin.stale ? "Weak" : "Excellent"}
            </span>
          </div>
        )}
      </div>

      <div className="border-t border-slate-100/60 pt-4 mt-5 flex gap-2 justify-end">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onRunReadinessCheck(manikin.deviceId)}
        >
          Readiness Check
        </Button>
        {isReadyDevice && (
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => onOpenStartModal(manikin.deviceId)}
          >
            Start Session
          </Button>
        )}
        {isActive && manikin.activeSessionId && (
          <Button
            type="button"
            variant="success"
            size="sm"
            onClick={() => onViewSession(manikin.activeSessionId!)}
          >
            View Session
          </Button>
        )}
      </div>
    </Card>
  );
}

export default DeviceCard;
