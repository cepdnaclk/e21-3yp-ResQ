import { useEffect, useState } from "react";
import { fetchDeviceReadiness, startCalibration, cancelCalibration } from "../../api/firmwareApi";
import { fetchLiveManikin } from "../../api/manikinsApi";
import type { FirmwareReadinessResponse } from "../../types/firmware";
import type { ManikinLiveSummary } from "../../types/manikin";
import Card, { CardHeader } from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import PageHeader from "../../components/ui/PageHeader";
import { ReadinessChecklist } from "../../components/cpr/ReadinessChecklist";

type ManikinReadinessPageProps = {
  deviceId: string;
  onBack: () => void;
};

export function ManikinReadinessPage({ deviceId, onBack }: ManikinReadinessPageProps) {
  const [readiness, setReadiness] = useState<FirmwareReadinessResponse | null>(null);
  const [liveSummary, setLiveSummary] = useState<ManikinLiveSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    try {
      const [readinessRes, liveRes] = await Promise.all([
        fetchDeviceReadiness(deviceId),
        fetchLiveManikin(deviceId),
      ]);
      setReadiness(readinessRes);
      setLiveSummary(liveRes);
    } catch (err) {
      setError("Unable to retrieve readiness information for this device.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 3000); // poll readiness status every 3s
    return () => clearInterval(interval);
  }, [deviceId]);

  async function handleStartCheck() {
    setActionLoading(true);
    setError(null);
    try {
      await startCalibration(deviceId);
      await loadData();
    } catch (err) {
      setError("Failed to start the readiness check.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCancelCheck() {
    setActionLoading(true);
    setError(null);
    try {
      await cancelCalibration(deviceId);
      await loadData();
    } catch (err) {
      setError("Failed to cancel the readiness check.");
    } finally {
      setActionLoading(false);
    }
  }

  const checking = liveSummary?.state === "CALIBRATION_ACTIVE" || liveSummary?.state === "CALIBRATING";

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PageHeader
        title="Device Readiness Check"
        subtitle={`Validate sensors and calibration state for device: ${deviceId}`}
        back={{ label: "Back to Dashboard", onClick: onBack }}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Actions panel */}
        <Card className="md:col-span-1">
          <CardHeader title="Control Panel" />
          <p className="text-xs text-gray-500 mb-4">
            Performing a readiness check ensures force, depth, and placement sensors are calibrated correctly.
          </p>

          <div className="flex flex-col gap-2">
            {!checking ? (
              <Button
                type="button"
                className="w-full justify-center"
                loading={actionLoading}
                onClick={handleStartCheck}
              >
                Run Readiness Check
              </Button>
            ) : (
              <Button
                type="button"
                variant="danger"
                className="w-full justify-center"
                loading={actionLoading}
                onClick={handleCancelCheck}
              >
                Cancel Check
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              className="w-full justify-center"
              onClick={onBack}
            >
              Close
            </Button>
          </div>

          {error && (
            <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-semibold text-red-700">
              {error}
            </div>
          )}
        </Card>

        {/* Checklist Panel */}
        <Card className="md:col-span-2">
          <CardHeader
            title="Readiness Checklist"
            subtitle={checking ? "Check in progress... please do not touch the chest sensor." : "Verify before training."}
          />
          <ReadinessChecklist
            readiness={readiness}
            liveSummary={liveSummary}
            loading={loading}
          />
        </Card>
      </div>
    </div>
  );
}

export default ManikinReadinessPage;
