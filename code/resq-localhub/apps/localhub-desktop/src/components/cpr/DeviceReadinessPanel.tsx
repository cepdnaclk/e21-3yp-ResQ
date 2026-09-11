import type { ManikinLiveSummary } from "../../types/manikin";
import { useDeviceReadiness } from "../../hooks/useDeviceReadiness";
import Card, { CardHeader } from "../ui/Card";
import Button from "../ui/Button";
import { ReadinessChecklist } from "./ReadinessChecklist";

type DeviceReadinessPanelProps = {
  deviceId: string;
  liveSummary: ManikinLiveSummary | null;
  onContinue: () => void;
  continueLabel?: string;
  showBack?: boolean;
  onBack?: () => void;
  onRunCalibration: (deviceId: string) => void;
};

export function DeviceReadinessPanel({
  deviceId,
  liveSummary,
  onContinue,
  continueLabel = "Continue",
  showBack = false,
  onBack,
  onRunCalibration,
}: DeviceReadinessPanelProps) {
  const {
    readiness,
    loading,
  } = useDeviceReadiness(deviceId, false);

  const calibrationPending =
    readiness?.calibrationState === "STARTING" ||
    readiness?.calibrationState === "CALIBRATING" ||
    readiness?.calibrationState === "RUNNING";
  const sessionActive =
    liveSummary?.sessionActive === true ||
    liveSummary?.activeSessionId != null ||
    readiness?.firmwareState === "SESSION_ACTIVE";
  const online =
    liveSummary?.online === true &&
    liveSummary.offline !== true &&
    liveSummary.stale !== true;
  const trustedCalibration =
    liveSummary?.calibrated === true ||
    (readiness?.calibrationStorageStatus === "VALID" &&
      readiness?.recalibrationRequired === false);
  const ready = online && !sessionActive && readiness?.readyForSession === true;

  return (
    <Card className="p-6">
      <CardHeader
        title="Device Readiness"
        subtitle="Confirm connectivity and calibration before launching the session."
      />

      <div className="mt-5">
        <ReadinessChecklist
          readiness={readiness}
          liveSummary={liveSummary}
          loading={loading}
        />
      </div>

      {sessionActive && (
        <p className="mt-4 text-xs font-semibold text-amber-700">
          Calibration is unavailable while this manikin has an active session.
        </p>
      )}

      <div className="mt-6 pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex gap-2">
          {showBack && onBack && (
            <Button type="button" variant="secondary" onClick={onBack}>
              Back
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            onClick={() => onRunCalibration(deviceId)}
            disabled={!online || sessionActive || calibrationPending}
          >
            {calibrationPending
              ? "Calibration in progress"
              : trustedCalibration
              ? "Recalibrate"
              : "Calibrate"}
          </Button>
        </div>

        <Button
          type="button"
          variant="primary"
          onClick={onContinue}
          disabled={!ready}
        >
          {continueLabel}
        </Button>
      </div>
    </Card>
  );
}

export default DeviceReadinessPanel;
