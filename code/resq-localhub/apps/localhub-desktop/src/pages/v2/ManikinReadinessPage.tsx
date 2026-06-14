import { useEffect, useState } from "react";
import {
  fetchDeviceReadiness,
  startCalibration,
  cancelCalibration,
  fetchDeviceDiagnostics,
  requestDebugSnapshot,
} from "../../api/firmwareApi";
import { fetchLiveManikin } from "../../api/manikinsApi";
import type { FirmwareReadinessResponse, FirmwareDeviceDiagnosticsResponse } from "../../types/firmware";
import type { ManikinLiveSummary } from "../../types/manikin";
import Card, { CardHeader } from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import PageHeader from "../../components/ui/PageHeader";
import { ReadinessChecklist } from "../../components/cpr/ReadinessChecklist";
import type { ChestPressureProfile } from "../../types/chestPressureProfile";

type ManikinReadinessPageProps = {
  deviceId: string;
  onBack: () => void;
};

const PROTOTYPE_PRESSURE_PROFILES: ChestPressureProfile[] = [
  {
    profileId: "prototype-adult-standard",
    displayName: "Prototype Adult Standard",
    referenceTargetRaw: 20000,
    leftBladderTargetAboveReferenceRaw: 5000,
    rightBladderTargetAboveReferenceRaw: 5000,
    pressureToleranceRaw: 1000,
    maxBalanceDifferenceRaw: 800,
    hallDeltaRaw: 13500,
    pressureBalanceAllowedPct: 25,
  },
  {
    profileId: "prototype-youth-teen",
    displayName: "Prototype Youth / Teen",
    referenceTargetRaw: 18000,
    leftBladderTargetAboveReferenceRaw: 4000,
    rightBladderTargetAboveReferenceRaw: 4000,
    pressureToleranceRaw: 1000,
    maxBalanceDifferenceRaw: 800,
    hallDeltaRaw: 12000,
    pressureBalanceAllowedPct: 25,
  },
  {
    profileId: "prototype-child",
    displayName: "Prototype Child",
    referenceTargetRaw: 15000,
    leftBladderTargetAboveReferenceRaw: 3000,
    rightBladderTargetAboveReferenceRaw: 3000,
    pressureToleranceRaw: 1000,
    maxBalanceDifferenceRaw: 800,
    hallDeltaRaw: 10000,
    pressureBalanceAllowedPct: 25,
  },
];

const RAW_MIN_SAFE = 100;
const RAW_MAX_SAFE = 16777000;

function isInvalidPressureReading(value: number | null | undefined): boolean {
  return (
    value == null ||
    Number.isNaN(value) ||
    value <= RAW_MIN_SAFE ||
    value >= RAW_MAX_SAFE
  );
}

function getFriendlyStateLabel(state: string | null | undefined, online: boolean): string {
  if (!online) return "Offline";
  if (!state) return "Readiness check required";
  const s = state.toUpperCase();
  if (s === "PAIRED_IDLE" || s === "UNKNOWN") return "Readiness check required";
  if (s === "CALIBRATING" || s === "CALIBRATION_ACTIVE") return "Checking manikin...";
  if (s === "READY_FOR_SESSION" || s === "READY") return "Ready for training";
  if (s === "CALIBRATION_FAIL" || s === "CALIBRATION_FAILED" || s === "FAIL") return "Readiness check failed";
  if (s === "SESSION_ACTIVE" || s === "ACTIVE") return "Session running";
  if (s === "ERROR") return "Needs support";
  return state;
}

export function ManikinReadinessPage({ deviceId, onBack }: ManikinReadinessPageProps) {
  // Tabs State
  const [activeTab, setActiveTab] = useState<"setup" | "readiness">("setup");

  // API Live Data State
  const [readiness, setReadiness] = useState<FirmwareReadinessResponse | null>(null);
  const [liveSummary, setLiveSummary] = useState<ManikinLiveSummary | null>(null);
  const [diagnostics, setDiagnostics] = useState<FirmwareDeviceDiagnosticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pressure Profiles State
  const [profiles, setProfiles] = useState<ChestPressureProfile[]>(PROTOTYPE_PRESSURE_PROFILES);
  const [selectedProfileId, setSelectedProfileId] = useState("prototype-adult-standard");
  const [pressureSetupSaved, setPressureSetupSaved] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const activeProfile = profiles.find((p) => p.profileId === selectedProfileId) || profiles[0];

  // Refresh live summaries and diagnostics at regular intervals
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        const [readinessRes, liveRes, diagRes] = await Promise.all([
          fetchDeviceReadiness(deviceId),
          fetchLiveManikin(deviceId),
          fetchDeviceDiagnostics(deviceId).catch(() => null),
        ]);
        if (!cancelled) {
          setReadiness(readinessRes);
          setLiveSummary(liveRes);
          if (diagRes) {
            setDiagnostics(diagRes);
          }
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError("Unable to retrieve readiness information for this device.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    async function triggerDebug() {
      try {
        await requestDebugSnapshot(deviceId);
      } catch (err) {
        console.warn("Failed to request debug snapshot", err);
      }
    }

    loadData();
    triggerDebug();

    const dataInterval = setInterval(loadData, 1000);
    const debugInterval = setInterval(triggerDebug, 2000);

    return () => {
      cancelled = true;
      clearInterval(dataInterval);
      clearInterval(debugInterval);
    };
  }, [deviceId]);

  // Extract raw pressure values from latest debug snapshot
  const latestSnapshot = diagnostics?.debugSnapshots?.[0];

  const pressure0Raw = latestSnapshot?.pressure0Raw ?? null;
  const pressure1Raw = latestSnapshot?.pressure1Raw ?? null;
  const pressure2Raw = latestSnapshot?.pressure2Raw ?? null;

  const leftEffectiveRaw =
    pressure1Raw != null && pressure0Raw != null ? pressure1Raw - pressure0Raw : null;
  const rightEffectiveRaw =
    pressure2Raw != null && pressure0Raw != null ? pressure2Raw - pressure0Raw : null;
  const balanceDifferenceRaw =
    leftEffectiveRaw != null && rightEffectiveRaw != null
      ? Math.abs(leftEffectiveRaw - rightEffectiveRaw)
      : null;

  // Saturated/invalid readings verification
  const p0Invalid = isInvalidPressureReading(pressure0Raw);
  const p1Invalid = isInvalidPressureReading(pressure1Raw);
  const p2Invalid = isInvalidPressureReading(pressure2Raw);
  const hasInvalidSensor = p0Invalid || p1Invalid || p2Invalid;

  // Tolerances checks
  const refDiff = pressure0Raw != null ? pressure0Raw - activeProfile.referenceTargetRaw : null;
  const refWithin = refDiff != null ? Math.abs(refDiff) <= activeProfile.pressureToleranceRaw : false;

  const leftDiff =
    leftEffectiveRaw != null ? leftEffectiveRaw - activeProfile.leftBladderTargetAboveReferenceRaw : null;
  const leftWithin = leftDiff != null ? Math.abs(leftDiff) <= activeProfile.pressureToleranceRaw : false;

  const rightDiff =
    rightEffectiveRaw != null ? rightEffectiveRaw - activeProfile.rightBladderTargetAboveReferenceRaw : null;
  const rightWithin = rightDiff != null ? Math.abs(rightDiff) <= activeProfile.pressureToleranceRaw : false;

  const balanceWithin =
    balanceDifferenceRaw != null ? balanceDifferenceRaw <= activeProfile.maxBalanceDifferenceRaw : false;

  const allTargetsMet =
    !hasInvalidSensor &&
    pressure0Raw != null &&
    leftEffectiveRaw != null &&
    rightEffectiveRaw != null &&
    refWithin &&
    leftWithin &&
    rightWithin &&
    balanceWithin;

  const checking = liveSummary?.state === "CALIBRATION_ACTIVE" || liveSummary?.state === "CALIBRATING";
  const online = liveSummary?.online ?? false;

  // Start Session validation check
  const readyFromFirmware =
    liveSummary?.state === "READY_FOR_SESSION" ||
    readiness?.source === "FIRMWARE_READY_STATE" ||
    readiness?.firmwareState === "READY_FOR_SESSION";

  const isStartSessionEnabled =
    (readyFromFirmware || (pressureSetupSaved && readiness?.ready)) &&
    online &&
    !checking;

  async function handleStartCheck() {
    setActionLoading(true);
    setError(null);
    try {
      const requestPayload = {
        profileId: activeProfile.profileId,
        hallDelta: activeProfile.hallDeltaRaw ?? 13500,
        refPressure: activeProfile.referenceTargetRaw,
        bladder1Pressure: activeProfile.referenceTargetRaw + activeProfile.leftBladderTargetAboveReferenceRaw,
        bladder2Pressure: activeProfile.referenceTargetRaw + activeProfile.rightBladderTargetAboveReferenceRaw,
      };
      await startCalibration(deviceId, requestPayload);
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
    } catch (err) {
      setError("Failed to cancel the readiness check.");
    } finally {
      setActionLoading(false);
    }
  }

  function handleSavePressureSetup() {
    if (!allTargetsMet) {
      return;
    }
    setPressureSetupSaved(true);
    setActiveTab("readiness");
  }

  function updateActiveProfileField(field: keyof ChestPressureProfile, val: number) {
    setProfiles((prev) =>
      prev.map((p) => {
        if (p.profileId === selectedProfileId) {
          return { ...p, [field]: val };
        }
        return p;
      })
    );
    setPressureSetupSaved(false);
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 select-none">
      <PageHeader
        title="Manikin Setup & Readiness"
        subtitle={`Configure the air-bladder levels and test training readiness for device: ${deviceId}`}
        back={{ label: "Back to Dashboard", onClick: onBack }}
      />

      {/* Tabs Switcher Navigation */}
      <div className="flex border-b border-slate-200">
        <button
          type="button"
          onClick={() => setActiveTab("setup")}
          className={`px-6 py-3 text-sm font-bold border-b-2 transition-all cursor-pointer ${
            activeTab === "setup"
              ? "border-teal-600 text-teal-600 font-extrabold"
              : "border-transparent text-slate-400 hover:text-slate-600"
          }`}
        >
          1. Chest Pressure Setup
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("readiness")}
          className={`px-6 py-3 text-sm font-bold border-b-2 transition-all cursor-pointer ${
            activeTab === "readiness"
              ? "border-teal-600 text-teal-600 font-extrabold"
              : "border-transparent text-slate-400 hover:text-slate-600"
          }`}
        >
          2. Readiness Check
        </button>
      </div>

      {activeTab === "setup" ? (
        // TAB 1: Chest Pressure Setup
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Left Side: Setup info, profile selection & targets editor */}
          <Card className="flex flex-col justify-between p-8">
            <div className="space-y-6">
              <CardHeader
                title="Chest Pressure Setup"
                subtitle="Calibrate chamber pressures prior to starting readiness checks."
              />

              <div className="space-y-4">
                <div>
                  <label htmlFor="profileSelect" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Training Profile
                  </label>
                  <select
                    id="profileSelect"
                    value={selectedProfileId}
                    onChange={(e) => {
                      setSelectedProfileId(e.target.value);
                      setPressureSetupSaved(false);
                    }}
                    className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 bg-slate-50/50 hover:bg-slate-50 transition-colors focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 cursor-pointer font-semibold"
                  >
                    {profiles.map((p) => (
                      <option key={p.profileId} value={p.profileId}>
                        {p.displayName}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Collapsible targets editor */}
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
                    Customize Target Levels
                  </button>

                  {showAdvanced && (
                    <div className="mt-4 space-y-3.5 bg-slate-50/50 p-4 border border-slate-100 rounded-xl animate-fadeIn text-xs">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                            Reference Target
                          </label>
                          <input
                            type="number"
                            value={activeProfile.referenceTargetRaw}
                            onChange={(e) => updateActiveProfileField("referenceTargetRaw", Number(e.target.value))}
                            className="w-full px-3 py-1.5 border border-slate-200 bg-white rounded-lg text-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-500 font-mono font-bold"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                            Tolerance Limit
                          </label>
                          <input
                            type="number"
                            value={activeProfile.pressureToleranceRaw}
                            onChange={(e) => updateActiveProfileField("pressureToleranceRaw", Number(e.target.value))}
                            className="w-full px-3 py-1.5 border border-slate-200 bg-white rounded-lg text-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-500 font-mono font-bold"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                            Left Bladder Target
                          </label>
                          <input
                            type="number"
                            value={activeProfile.leftBladderTargetAboveReferenceRaw}
                            onChange={(e) => updateActiveProfileField("leftBladderTargetAboveReferenceRaw", Number(e.target.value))}
                            className="w-full px-3 py-1.5 border border-slate-200 bg-white rounded-lg text-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-500 font-mono font-bold"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                            Right Bladder Target
                          </label>
                          <input
                            type="number"
                            value={activeProfile.rightBladderTargetAboveReferenceRaw}
                            onChange={(e) => updateActiveProfileField("rightBladderTargetAboveReferenceRaw", Number(e.target.value))}
                            className="w-full px-3 py-1.5 border border-slate-200 bg-white rounded-lg text-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-500 font-mono font-bold"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                          Max Balance Difference
                        </label>
                        <input
                          type="number"
                          value={activeProfile.maxBalanceDifferenceRaw}
                          onChange={(e) => updateActiveProfileField("maxBalanceDifferenceRaw", Number(e.target.value))}
                          className="w-full px-3 py-1.5 border border-slate-200 bg-white rounded-lg text-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-500 font-mono font-bold"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Numbered Setup Steps */}
              <div className="bg-slate-50/60 border border-slate-100/80 p-5 rounded-2xl">
                <h4 className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-3.5">Setup Instructions</h4>
                <ol className="space-y-2.5 text-xs text-slate-500 font-medium leading-relaxed font-sans list-decimal pl-4">
                  <li>Turn on the manikin.</li>
                  <li>Make sure the manikin is connected.</li>
                  <li>Use the reference pump to set the reference chamber.</li>
                  <li>Use the left and right bladder pumps to adjust chest feel.</li>
                  <li>Wait until all cards show “Good range.”</li>
                  <li>Save pressure setup.</li>
                  <li>Run readiness check.</li>
                </ol>
              </div>
            </div>

            {/* Actions Footer */}
            <div className="pt-6 border-t border-slate-100 flex justify-between items-center gap-3">
              {pressureSetupSaved ? (
                <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
                  ✓ Pressure setup ready
                </span>
              ) : (
                <span className="text-xs text-slate-400 font-semibold">
                  Adjust sensor values to meet targets
                </span>
              )}
              <Button
                type="button"
                variant="primary"
                onClick={handleSavePressureSetup}
                disabled={!allTargetsMet}
                className="font-bold px-6 shadow-sm"
              >
                Save Pressure Setup
              </Button>
            </div>
          </Card>

          {/* Right Side: Four Live pressure cards */}
          <div className="space-y-4">
            {/* Sensor fault alert */}
            {hasInvalidSensor && (
              <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl text-xs text-rose-700 font-bold space-y-1 animate-fadeIn">
                <div className="flex items-center gap-1.5">
                  <span>⚠</span> Sensor out of range
                </div>
                <p className="text-[10px] text-rose-500 font-normal leading-relaxed">
                  Pressure sensor readings are outside typical safe bounds. Ensure the chamber is not heavily over-pressurized and check connections. Open Technician Diagnostics for raw numbers.
                </p>
              </div>
            )}

            {/* 1. Reference Chamber */}
            <div
              className={`p-5 rounded-2xl border transition-all duration-300 flex flex-col justify-between gap-1.5 ${
                p0Invalid
                  ? "bg-rose-50/20 border-rose-100/80 text-rose-800"
                  : refWithin
                  ? "bg-emerald-50/20 border-emerald-100/80 text-emerald-800"
                  : "bg-amber-50/20 border-amber-100/80 text-amber-800"
              }`}
            >
              <div className="flex justify-between items-center">
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-400">Reference Chamber</span>
                {p0Invalid ? (
                  <span className="text-[10px] font-bold bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full uppercase tracking-wider">Fault</span>
                ) : refWithin ? (
                  <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full uppercase tracking-wider">Good range</span>
                ) : (
                  <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full uppercase tracking-wider">Adjust</span>
                )}
              </div>
              <div className="flex justify-between items-baseline mt-2.5">
                <div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Current</span>
                  <span className="text-2xl font-black font-mono tracking-tight leading-none mt-1">
                    {p0Invalid ? "—" : pressure0Raw != null ? String(pressure0Raw) : "Waiting"}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Target</span>
                  <span className="text-sm font-bold font-mono tracking-tight leading-none mt-1 text-slate-600 block">
                    {activeProfile.referenceTargetRaw} ±{activeProfile.pressureToleranceRaw}
                  </span>
                </div>
              </div>
              <div className="text-xs font-semibold leading-relaxed mt-2 pt-2 border-t border-slate-100/30 text-slate-600">
                {p0Invalid
                  ? "Sensor out of range."
                  : refDiff != null && refDiff < -activeProfile.pressureToleranceRaw
                  ? "Pump more air into the reference chamber."
                  : refDiff != null && refDiff > activeProfile.pressureToleranceRaw
                  ? "Release a little air from the reference chamber."
                  : "Reference chamber is in the target range."}
              </div>
            </div>

            {/* 2. Left Bladder */}
            <div
              className={`p-5 rounded-2xl border transition-all duration-300 flex flex-col justify-between gap-1.5 ${
                p1Invalid || p0Invalid
                  ? "bg-rose-50/20 border-rose-100/80 text-rose-800"
                  : leftWithin
                  ? "bg-emerald-50/20 border-emerald-100/80 text-emerald-800"
                  : "bg-amber-50/20 border-amber-100/80 text-amber-800"
              }`}
            >
              <div className="flex justify-between items-center">
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-400">Left Bladder</span>
                {p1Invalid || p0Invalid ? (
                  <span className="text-[10px] font-bold bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full uppercase tracking-wider">Fault</span>
                ) : leftWithin ? (
                  <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full uppercase tracking-wider">Good range</span>
                ) : (
                  <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full uppercase tracking-wider">Adjust</span>
                )}
              </div>
              <div className="flex justify-between items-baseline mt-2.5">
                <div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Current</span>
                  <span className="text-2xl font-black font-mono tracking-tight leading-none mt-1">
                    {p1Invalid || p0Invalid ? "—" : leftEffectiveRaw != null ? String(leftEffectiveRaw) : "Waiting"}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Target</span>
                  <span className="text-sm font-bold font-mono tracking-tight leading-none mt-1 text-slate-600 block">
                    {activeProfile.leftBladderTargetAboveReferenceRaw} ±{activeProfile.pressureToleranceRaw}
                  </span>
                </div>
              </div>
              <div className="text-xs font-semibold leading-relaxed mt-2 pt-2 border-t border-slate-100/30 text-slate-600">
                {p1Invalid || p0Invalid
                  ? "Sensor out of range."
                  : leftDiff != null && leftDiff < -activeProfile.pressureToleranceRaw
                  ? "Pump more air into the left bladder."
                  : leftDiff != null && leftDiff > activeProfile.pressureToleranceRaw
                  ? "Release a little air from the left bladder."
                  : "Left bladder is in the target range."}
              </div>
            </div>

            {/* 3. Right Bladder */}
            <div
              className={`p-5 rounded-2xl border transition-all duration-300 flex flex-col justify-between gap-1.5 ${
                p2Invalid || p0Invalid
                  ? "bg-rose-50/20 border-rose-100/80 text-rose-800"
                  : rightWithin
                  ? "bg-emerald-50/20 border-emerald-100/80 text-emerald-800"
                  : "bg-amber-50/20 border-amber-100/80 text-amber-800"
              }`}
            >
              <div className="flex justify-between items-center">
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-400">Right Bladder</span>
                {p2Invalid || p0Invalid ? (
                  <span className="text-[10px] font-bold bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full uppercase tracking-wider">Fault</span>
                ) : rightWithin ? (
                  <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full uppercase tracking-wider">Good range</span>
                ) : (
                  <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full uppercase tracking-wider">Adjust</span>
                )}
              </div>
              <div className="flex justify-between items-baseline mt-2.5">
                <div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Current</span>
                  <span className="text-2xl font-black font-mono tracking-tight leading-none mt-1">
                    {p2Invalid || p0Invalid ? "—" : rightEffectiveRaw != null ? String(rightEffectiveRaw) : "Waiting"}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Target</span>
                  <span className="text-sm font-bold font-mono tracking-tight leading-none mt-1 text-slate-600 block">
                    {activeProfile.rightBladderTargetAboveReferenceRaw} ±{activeProfile.pressureToleranceRaw}
                  </span>
                </div>
              </div>
              <div className="text-xs font-semibold leading-relaxed mt-2 pt-2 border-t border-slate-100/30 text-slate-600">
                {p2Invalid || p0Invalid
                  ? "Sensor out of range."
                  : rightDiff != null && rightDiff < -activeProfile.pressureToleranceRaw
                  ? "Pump more air into the right bladder."
                  : rightDiff != null && rightDiff > activeProfile.pressureToleranceRaw
                  ? "Release a little air from the right bladder."
                  : "Right bladder is in the target range."}
              </div>
            </div>

            {/* 4. Chest Balance */}
            <div
              className={`p-5 rounded-2xl border transition-all duration-300 flex flex-col justify-between gap-1.5 ${
                hasInvalidSensor
                  ? "bg-rose-50/20 border-rose-100/80 text-rose-800"
                  : balanceWithin
                  ? "bg-emerald-50/20 border-emerald-100/80 text-emerald-800"
                  : "bg-amber-50/20 border-amber-100/80 text-amber-800"
              }`}
            >
              <div className="flex justify-between items-center">
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-400">Chest Balance</span>
                {hasInvalidSensor ? (
                  <span className="text-[10px] font-bold bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full uppercase tracking-wider">Fault</span>
                ) : balanceWithin ? (
                  <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full uppercase tracking-wider">Balanced</span>
                ) : (
                  <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full uppercase tracking-wider">Skewed</span>
                )}
              </div>
              <div className="flex justify-between items-baseline mt-2.5">
                <div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Current Difference</span>
                  <span className="text-2xl font-black font-mono tracking-tight leading-none mt-1">
                    {hasInvalidSensor ? "—" : balanceDifferenceRaw != null ? String(balanceDifferenceRaw) : "Waiting"}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Max Target Difference</span>
                  <span className="text-sm font-bold font-mono tracking-tight leading-none mt-1 text-slate-600 block">
                    {activeProfile.maxBalanceDifferenceRaw}
                  </span>
                </div>
              </div>
              <div className="text-xs font-semibold leading-relaxed mt-2 pt-2 border-t border-slate-100/30 text-slate-600">
                {hasInvalidSensor
                  ? "Sensor out of range."
                  : balanceWithin
                  ? "Chest pressure is balanced."
                  : leftEffectiveRaw != null && rightEffectiveRaw != null && leftEffectiveRaw > rightEffectiveRaw
                  ? "Left side is firmer. Release left slightly or add air to right."
                  : "Right side is firmer. Release right slightly or add air to left."}
              </div>
            </div>
          </div>
        </div>
      ) : (
        // TAB 2: Readiness Check
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-fadeIn">
          {/* Left: Checklist Verification */}
          <Card className="flex flex-col justify-between p-8">
            <div>
              <CardHeader
                title="Readiness Checklist"
                subtitle={checking ? "Check in progress... please do not touch the chest sensor." : "Validate sensors and link state."}
              />
              <ReadinessChecklist readiness={readiness} liveSummary={liveSummary} loading={loading} />

              {/* Live Guidance steps */}
              <div className="mt-6 p-5 rounded-2xl bg-slate-50/60 border border-slate-100/80">
                <h4 className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-3">Guidance during check</h4>
                <ul className="space-y-2 text-xs text-slate-500 font-medium list-disc pl-4 leading-relaxed font-sans">
                  <li>Place the manikin on a stable flat surface.</li>
                  <li>Keep hands off the chest.</li>
                  <li>When asked, press the chest once firmly and hold briefly.</li>
                  <li>Release fully.</li>
                </ul>
              </div>
            </div>
          </Card>

          {/* Right: Circular dial & Action buttons */}
          <Card className="flex flex-col justify-between items-center text-center p-8">
            <div className="w-full">
              <CardHeader title="System Status Dial" className="text-left" />

              <div className="my-8 flex justify-center">
                <div
                  className={`w-48 h-48 rounded-full border-[10px] flex flex-col items-center justify-center bg-slate-50 transition-all duration-300 relative ${
                    readyFromFirmware
                      ? "border-emerald-500 shadow-lg shadow-emerald-500/5 text-emerald-800"
                      : checking
                      ? "border-teal-500 animate-pulse text-teal-800"
                      : "border-amber-500 shadow-lg shadow-amber-500/5 text-amber-800"
                  }`}
                >
                  <div className="absolute inset-0.5 rounded-full border border-white/40" />
                  <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Device Dial</span>
                  <span className="text-lg font-extrabold tracking-tight mt-1 px-4 leading-tight">
                    {getFriendlyStateLabel(liveSummary?.state, online)}
                  </span>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mt-1">
                    {readyFromFirmware
                      ? "Ready for training"
                      : checking
                      ? "Keep sensor level"
                      : "Readiness check required"}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions Buttons */}
            <div className="w-full space-y-3 mt-4">
              {!checking ? (
                <Button
                  type="button"
                  variant="primary"
                  className="w-full justify-center py-3 font-bold"
                  loading={actionLoading}
                  onClick={handleStartCheck}
                  disabled={hasInvalidSensor}
                >
                  Run Readiness Check
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="danger"
                  className="w-full justify-center py-3 font-bold"
                  loading={actionLoading}
                  onClick={handleCancelCheck}
                >
                  Cancel Readiness Check
                </Button>
              )}

              <Button
                type="button"
                variant="success"
                className="w-full justify-center py-3 font-bold"
                disabled={!isStartSessionEnabled}
                onClick={onBack}
              >
                Start Training Session
              </Button>
            </div>

            {error && (
              <div className="w-full mt-4 p-3.5 rounded-xl bg-rose-50 border border-rose-100 text-xs font-semibold text-rose-700 text-left">
                {error}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

export default ManikinReadinessPage;
