import { useEffect, useState } from "react";
import {
  startCalibration,
  cancelCalibration,
  requestDebugSnapshot,
} from "../../api/firmwareApi";
import { useDeviceReadiness } from "../../hooks/useDeviceReadiness";
import { useCalibrationProfiles } from "../../hooks/useCalibrationProfiles";
import {
  deriveReadinessUiState,
  getFriendlyReason,
  getFriendlyAction,
} from "../../utils/readinessState";
import type { ManikinLiveSummary } from "../../types/manikin";
import Card, { CardHeader } from "../ui/Card";
import Button from "../ui/Button";
import StatusBadge from "../ui/StatusBadge";
import { ReadinessChecklist } from "./ReadinessChecklist";
import { CalibrationProfileCard } from "./CalibrationProfileCard";
import { CalibrationProgressStepper } from "./CalibrationProgressStepper";
import { CalibrationResultCard } from "./CalibrationResultCard";

type DeviceReadinessPanelProps = {
  deviceId: string;
  liveSummary: ManikinLiveSummary | null;
  onContinue: () => void;
  continueLabel?: string;
  showBack?: boolean;
  onBack?: () => void;
};

export function DeviceReadinessPanel({
  deviceId,
  liveSummary,
  onContinue,
  continueLabel = "Continue",
  showBack = false,
  onBack,
}: DeviceReadinessPanelProps) {
  if (!deviceId) {
    return (
      <Card className="p-6 text-center select-none">
        <p className="text-slate-500 text-sm font-semibold">
          Select a manikin to run readiness check.
        </p>
      </Card>
    );
  }

  // Calibration Profiles
  const {
    profiles,
    defaultProfile,
    loading: profilesLoading,
    error: profilesError,
    refetch: refetchProfiles,
  } = useCalibrationProfiles();

  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customValues, setCustomValues] = useState({
    hallDelta: "",
    refPressure: "",
    bladder1Pressure: "",
    bladder2Pressure: "",
  });

  const safeProfiles = profiles || [];
  const activeProfile =
    safeProfiles.find((p) => p.profileId === selectedProfileId) ||
    defaultProfile ||
    safeProfiles[0] ||
    null;

  useEffect(() => {
    if (activeProfile) {
      setCustomValues({
        hallDelta: String(activeProfile.hallDelta),
        refPressure: String(activeProfile.refPressure),
        bladder1Pressure: String(activeProfile.bladder1Pressure),
        bladder2Pressure: String(activeProfile.bladder2Pressure),
      });
    }
  }, [activeProfile]);

  useEffect(() => {
    if (defaultProfile && !selectedProfileId) {
      setSelectedProfileId(defaultProfile.profileId);
    }
  }, [defaultProfile]);

  // Derived State and Readiness Polling
  const [calibrating, setCalibrating] = useState(false);
  const {
    readiness,
    loading: readinessLoading,
    error: readinessError,
    refetch,
  } = useDeviceReadiness(deviceId, calibrating);

  const derivedState = deriveReadinessUiState(liveSummary, readiness);

  useEffect(() => {
    setCalibrating(derivedState === "CALIBRATING");
  }, [derivedState]);

  // Actions states
  const [actionLoading, setActionLoading] = useState(false);
  const [debugLoading, setDebugLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optimisticStatus, setOptimisticStatus] = useState<string | null>(null);

  // Validation
  const validateValues = () => {
    const hall = Number(customValues.hallDelta);
    const ref = Number(customValues.refPressure);
    const b1 = Number(customValues.bladder1Pressure);
    const b2 = Number(customValues.bladder2Pressure);

    return (
      Number.isFinite(hall) && hall > 0 &&
      Number.isFinite(ref) && ref > 0 &&
      Number.isFinite(b1) && b1 > 0 &&
      Number.isFinite(b2) && b2 > 0
    );
  };

  const isFormValid = validateValues();

  // Handlers
  async function handleStartCalibration() {
    if (!activeProfile || !isFormValid) return;
    setActionLoading(true);
    setError(null);
    setOptimisticStatus("Command sent");
    try {
      const payload = {
        profileId: activeProfile?.profileId || null,
        hallDelta: Number(customValues.hallDelta),
        refPressure: Number(customValues.refPressure),
        bladder1Pressure: Number(customValues.bladder1Pressure),
        bladder2Pressure: Number(customValues.bladder2Pressure),
      };
      await startCalibration(deviceId, payload);
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start calibration pre-check.");
      setOptimisticStatus(null);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCancelCalibration() {
    setActionLoading(true);
    setError(null);
    try {
      await cancelCalibration(deviceId);
      setOptimisticStatus(null);
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel calibration.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRequestDebug() {
    setDebugLoading(true);
    setError(null);
    try {
      await requestDebugSnapshot(deviceId);
      setError("Debug snapshot request published successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to request debug snapshot.");
    } finally {
      setDebugLoading(false);
    }
  }

  // derive start training disabled
  const isStartTrainingEnabled =
    liveSummary?.online &&
    !liveSummary?.offline &&
    !liveSummary?.stale &&
    readiness?.firmwareState === "READY_FOR_SESSION" &&
    readiness?.readyForSession === true;


  // Render helpers for status hero
  const renderStatusHero = () => {
    switch (derivedState) {
      case "OFFLINE":
        return (
          <div className="bg-slate-100 border border-slate-200 rounded-2xl p-6 text-left flex items-start gap-4 animate-fadeIn">
            <span className="text-2xl text-slate-400 font-extrabold shrink-0">◰</span>
            <div>
              <h4 className="text-sm font-black text-slate-700">Device Offline</h4>
              <p className="text-xs text-slate-500 mt-1 font-medium leading-relaxed">
                The manikin is unreachable. Ensure the power switch is turned on and that it is within range.
              </p>
              {liveSummary?.lastSeen && (
                <p className="text-[10px] text-slate-400 mt-2 font-mono">
                  Last seen: {new Date(liveSummary.lastSeen).toLocaleString()}
                </p>
              )}
            </div>
          </div>
        );
      case "ACTIVE_SESSION":
        return (
          <div className="bg-teal-50 border border-teal-100 rounded-2xl p-6 text-left flex items-start gap-4 animate-fadeIn">
            <span className="text-2xl text-teal-600 shrink-0">⚡</span>
            <div>
              <h4 className="text-sm font-black text-teal-800 font-extrabold">Active Practice Session</h4>
              <p className="text-xs text-teal-600 mt-1 font-semibold leading-relaxed">
                This manikin is currently in use for an active CPR training session. Calibration options are disabled.
              </p>
            </div>
          </div>
        );
      case "CALIBRATING":
        return (
          <div className="space-y-4">
            <div className="bg-teal-50/60 border border-teal-100/80 rounded-2xl p-6 text-left flex items-start gap-4 animate-fadeIn">
              <span className="w-2.5 h-2.5 bg-teal-500 rounded-full animate-ping mt-1.5 shrink-0" />
              <div>
                <h4 className="text-sm font-black text-teal-800 font-extrabold">Pre-Check Running</h4>
                <p className="text-xs text-teal-600 mt-1 font-semibold leading-relaxed">
                  Executing calibration tests. Keep hands off the manikin chest sensor unless prompted.
                </p>
              </div>
            </div>
            <CalibrationProgressStepper progressId={readiness?.progressId} />
            <Button
              type="button"
              variant="danger"
              className="w-full justify-center font-bold"
              loading={actionLoading}
              onClick={handleCancelCalibration}
            >
              Cancel Calibration
            </Button>
          </div>
        );
      case "READY":
        return (
          <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-6 text-left flex items-start gap-4 animate-fadeIn">
            <span className="text-2xl text-emerald-600 shrink-0 font-extrabold">✓</span>
            <div>
              <h4 className="text-sm font-black text-emerald-800 font-extrabold">Ready for Session</h4>
              <p className="text-xs text-emerald-600 mt-1 font-semibold leading-relaxed">
                Calibration pre-check passed successfully. This manikin is optimized and ready for CPR practice.
              </p>
            </div>
          </div>
        );
      case "FAILED":
        return (
          <CalibrationResultCard
            reasonId={readiness?.reasonId}
            actionId={readiness?.actionId}
            lastErrorId={readiness?.lastErrorId}
            onRetry={handleStartCalibration}
            onRequestDebug={handleRequestDebug}
            debugLoading={debugLoading}
          />
        );
      case "ERROR":
        return (
          <div className="bg-rose-50 border border-rose-100 rounded-2xl p-6 text-left flex items-start gap-4 animate-fadeIn space-y-3 flex-col">
            <div className="flex gap-4 items-start">
              <span className="text-2xl text-rose-600 shrink-0">⚠</span>
              <div>
                <h4 className="text-sm font-black text-rose-800 font-extrabold">Firmware Needs Attention</h4>
                <p className="text-xs text-rose-600 mt-1 font-semibold leading-relaxed">
                  The device reported a system error. Please review the recovery options or request diagnostic logs.
                </p>
                {readiness?.lastErrorId && (
                  <p className="text-[10px] text-rose-500 mt-1.5 font-semibold">
                    Last error ID: {readiness.lastErrorId}
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-2 w-full border-t border-rose-100/50 pt-3.5">
              <Button
                type="button"
                variant="secondary"
                onClick={handleRequestDebug}
                loading={debugLoading}
                className="text-rose-700 bg-white border border-rose-100 text-xs font-bold font-sans"
              >
                Request Debug Snapshot
              </Button>
            </div>
          </div>
        );
      case "CALIBRATION_REQUIRED":
      default:
        return (
          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-6 text-left flex items-start gap-4 animate-fadeIn">
            <span className="text-2xl text-amber-600 shrink-0">⚙</span>
            <div>
              <h4 className="text-sm font-black text-amber-800 font-extrabold">Calibration Required</h4>
              <p className="text-xs text-amber-600 mt-1 font-semibold leading-relaxed">
                This manikin is connected but must pass a calibration pre-check before a CPR training session can be initiated.
              </p>
            </div>
          </div>
        );
    }
  };

  const getStatusBadgeTone = () => {
    switch (derivedState) {
      case "READY":
        return "success";
      case "CALIBRATING":
        return "info";
      case "FAILED":
      case "ERROR":
        return "danger";
      case "OFFLINE":
      default:
        return "muted";
    }
  };

  const getStatusBadgeLabel = () => {
    switch (derivedState) {
      case "READY":
        return "Ready";
      case "CALIBRATING":
        return "Running";
      case "FAILED":
        return "Failed";
      case "ERROR":
        return "Error";
      case "OFFLINE":
        return "Offline";
      case "ACTIVE_SESSION":
        return "In Use";
      case "CALIBRATION_REQUIRED":
      default:
        return "Needs Calibration";
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-left">
      {/* Left Column: Pre-Check Controls and Profile */}
      <div className="space-y-6">
        <Card className="p-6">
          <div className="flex justify-between items-center mb-4">
            <CardHeader title="Pre-Check Settings" />
            <StatusBadge
              tone={getStatusBadgeTone()}
              label={getStatusBadgeLabel()}
              dot={derivedState === "READY" || derivedState === "CALIBRATING"}
            />
          </div>

          {/* Profile Selector */}
          <div className="space-y-4">
            <div>
              <label htmlFor="profileSelect" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                Calibration Profile
              </label>
              <select
                id="profileSelect"
                value={selectedProfileId}
                onChange={(e) => {
                  setSelectedProfileId(e.target.value);
                  setError(null);
                }}
                disabled={profilesLoading || !!profilesError || derivedState === "CALIBRATING" || derivedState === "ACTIVE_SESSION" || derivedState === "OFFLINE"}
                className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 bg-slate-50/50 hover:bg-slate-50 transition-colors focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 font-semibold cursor-pointer"
              >
                {profilesLoading && <option value="">Loading profiles...</option>}
                {profilesError && <option value="">Error loading profiles</option>}
                {safeProfiles.map((p) => (
                  <option key={p.profileId} value={p.profileId}>
                    {p.name} {p.defaultProfile ? "(Default)" : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Profile Targets Overview */}
            {profilesError ? (
              <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl text-xs text-rose-800 space-y-2">
                <p className="font-semibold">{profilesError}</p>
                <Button
                  type="button"
                  variant="secondary"
                  className="text-rose-700 bg-white border border-rose-100 py-1 px-3 text-xs font-bold"
                  onClick={() => refetchProfiles()}
                >
                  Retry Loading Profiles
                </Button>
              </div>
            ) : profilesLoading ? (
              <div className="h-20 bg-slate-50 border border-slate-100 rounded-2xl animate-pulse flex items-center justify-center text-xs text-slate-400 font-bold uppercase tracking-wider">
                Loading Profiles...
              </div>
            ) : activeProfile ? (
              <CalibrationProfileCard profile={activeProfile} />
            ) : (
              <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl text-xs text-slate-500 font-semibold">
                No profiles available.
              </div>
            )}

            {/* Collapsible Advanced Override Fields */}
            {activeProfile && (
              <div className="border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-1.5 text-xs font-bold text-teal-600 hover:text-teal-700 transition-colors cursor-pointer"
                >
                  <svg
                    className={`w-3.5 h-3.5 transform transition-transform ${showAdvanced ? "rotate-90" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                  Advanced Calibration Values
                </button>

                {showAdvanced && (
                  <div className="mt-4 space-y-3 bg-slate-50/50 p-4 border border-slate-100 rounded-xl animate-fadeIn text-xs">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                          Hall Delta Target
                        </label>
                        <input
                          type="number"
                          value={customValues.hallDelta}
                          onChange={(e) =>
                            setCustomValues((prev) => ({ ...prev, hallDelta: e.target.value }))
                          }
                          disabled={derivedState === "CALIBRATING"}
                          className="w-full px-3 py-1.5 border border-slate-200 bg-white rounded-lg text-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-500 font-mono font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                          Reference Pressure
                        </label>
                        <input
                          type="number"
                          value={customValues.refPressure}
                          onChange={(e) =>
                            setCustomValues((prev) => ({ ...prev, refPressure: e.target.value }))
                          }
                          disabled={derivedState === "CALIBRATING"}
                          className="w-full px-3 py-1.5 border border-slate-200 bg-white rounded-lg text-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-500 font-mono font-bold"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                          Left Bladder Pressure
                        </label>
                        <input
                          type="number"
                          value={customValues.bladder1Pressure}
                          onChange={(e) =>
                            setCustomValues((prev) => ({ ...prev, bladder1Pressure: e.target.value }))
                          }
                          disabled={derivedState === "CALIBRATING"}
                          className="w-full px-3 py-1.5 border border-slate-200 bg-white rounded-lg text-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-500 font-mono font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                          Right Bladder Pressure
                        </label>
                        <input
                          type="number"
                          value={customValues.bladder2Pressure}
                          onChange={(e) =>
                            setCustomValues((prev) => ({ ...prev, bladder2Pressure: e.target.value }))
                          }
                          disabled={derivedState === "CALIBRATING"}
                          className="w-full px-3 py-1.5 border border-slate-200 bg-white rounded-lg text-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-500 font-mono font-bold"
                        />
                      </div>
                    </div>

                    {!isFormValid && (
                      <p className="text-[10px] text-rose-500 font-bold">
                        * All custom targets must be positive numbers.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Start Pre-check Action */}
          {derivedState !== "CALIBRATING" && (
            <div className="mt-6 pt-4 border-t border-slate-100 flex flex-col gap-2.5">
              <Button
                type="button"
                variant="primary"
                className="w-full justify-center py-2.5 font-bold"
                onClick={handleStartCalibration}
                loading={actionLoading}
                disabled={
                  !isFormValid ||
                  derivedState === "OFFLINE" ||
                  derivedState === "ACTIVE_SESSION" ||
                  profilesLoading
                }
              >
                Run Calibration Pre-Check
              </Button>
              {optimisticStatus && (
                <span className="text-[10px] text-teal-600 font-bold uppercase tracking-wider text-center animate-pulse">
                  {optimisticStatus}
                </span>
              )}
            </div>
          )}
        </Card>

        {error && (
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-150 text-xs font-semibold text-slate-700">
            {error}
          </div>
        )}
      </div>

      {/* Right Column: Status Hero, Checklist and Proceed Trigger */}
      <div className="space-y-6 flex flex-col justify-between">
        <div className="space-y-6">
          {renderStatusHero()}

          {/* Checklist */}
          <Card className="p-6">
            <CardHeader
              title="Readiness Checklist"
              subtitle={
                derivedState === "CALIBRATING"
                  ? "Precheck in progress... Keep chest clear."
                  : "Wireless and hardware sensor checkpoints."
              }
            />
            <div className="mt-4">
              <ReadinessChecklist
                readiness={readiness}
                liveSummary={liveSummary}
                loading={readinessLoading}
              />
            </div>
          </Card>
        </div>

        {/* Footer Navigation */}
        <div className="flex gap-3 pt-4 border-t border-slate-100">
          {showBack && onBack && (
            <Button
              type="button"
              variant="secondary"
              onClick={onBack}
              disabled={derivedState === "CALIBRATING" || actionLoading}
              className="font-bold px-6"
            >
              Back
            </Button>
          )}

          <Button
            type="button"
            variant="success"
            className="flex-1 justify-center py-3 font-bold"
            disabled={!isStartTrainingEnabled}
            onClick={onContinue}
          >
            {continueLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
export default DeviceReadinessPanel;
