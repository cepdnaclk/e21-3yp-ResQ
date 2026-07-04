import { useEffect, useState } from "react";
import {
  fetchDeviceReadiness,
  fetchDeviceDiagnostics,
  requestDebugSnapshot,
} from "../../api/firmwareApi";
import { fetchLiveManikin } from "../../api/manikinsApi";
import type { FirmwareReadinessResponse, FirmwareDeviceDiagnosticsResponse } from "../../types/firmware";
import type { ManikinLiveSummary } from "../../types/manikin";
import Card, { CardHeader } from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import PageHeader from "../../components/ui/PageHeader";
import type { ChestPressureProfile } from "../../types/chestPressureProfile";
import { useCalibrationProfiles } from "../../hooks/useCalibrationProfiles";
import { DeviceReadinessPanel } from "../../components/cpr/DeviceReadinessPanel";
import { ErrorBoundary, LoadingState } from "../../components/ui";

type ManikinReadinessPageProps = {
  deviceId: string;
  onBack: () => void;
};

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

function ManikinReadinessPageContent({ deviceId, onBack }: ManikinReadinessPageProps) {
  // Tabs State
  const [activeTab, setActiveTab] = useState<"setup" | "readiness">("setup");

  // API Live Data State
  const [readiness, setReadiness] = useState<FirmwareReadinessResponse | null>(null);
  const [liveSummary, setLiveSummary] = useState<ManikinLiveSummary | null>(null);
  const [diagnostics, setDiagnostics] = useState<FirmwareDeviceDiagnosticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pressure Profiles State
  const {
    profiles: backendProfiles,
    defaultProfile,
    loading: profilesLoading,
    error: profilesError,
    refetch: refetchProfiles,
  } = useCalibrationProfiles();

  const [profiles, setProfiles] = useState<ChestPressureProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [pressureSetupSaved, setPressureSetupSaved] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Map backend profiles to UI client profiles format
  useEffect(() => {
    const safeBackendProfiles = backendProfiles || [];
    if (safeBackendProfiles.length > 0) {
      setProfiles(
        safeBackendProfiles.map((p) => ({
          profileId: p.profileId,
          displayName: p.name,
          referenceTargetRaw: p.refPressure,
          leftBladderTargetAboveReferenceRaw: Math.max(0, p.bladder1Pressure - p.refPressure),
          rightBladderTargetAboveReferenceRaw: Math.max(0, p.bladder2Pressure - p.refPressure),
          pressureToleranceRaw: 1000,
          maxBalanceDifferenceRaw: 800,
          hallDeltaRaw: p.hallDelta,
        }))
      );
    }
  }, [backendProfiles]);

  useEffect(() => {
    if (defaultProfile && !selectedProfileId) {
      setSelectedProfileId(defaultProfile.profileId);
    }
  }, [defaultProfile]);

  const safeProfiles = profiles || [];
  const activeProfile = safeProfiles.find((p) => p.profileId === selectedProfileId) || safeProfiles[0] || null;

  // Refresh live summaries and diagnostics at regular intervals
  useEffect(() => {
    if (!deviceId) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    async function loadData() {
      try {
        const [readinessRes, liveRes, diagRes] = await Promise.all([
          fetchDeviceReadiness(deviceId),
          fetchLiveManikin(deviceId).catch(() => null),
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

  // Handle Loading & Error States
  if (!deviceId) {
    return (
      <div className="max-w-md mx-auto py-12 text-center select-none">
        <Card className="p-6">
          <p className="text-slate-500 text-sm font-semibold">
            Select a manikin to run readiness check.
          </p>
        </Card>
      </div>
    );
  }

  if (loading || profilesLoading) {
    return <LoadingState message="Loading manikin setup and readiness details..." />;
  }

  if (profilesError) {
    return (
      <div className="max-w-md mx-auto py-12 text-center space-y-4 animate-fadeIn select-none">
        <Card className="border-rose-100 bg-rose-50/50 p-6 text-rose-800">
          <h4 className="text-sm font-bold">Failed to Load Calibration Profiles</h4>
          <p className="text-xs text-rose-600 mt-2 font-medium">
            {profilesError}
          </p>
          <Button
            type="button"
            variant="primary"
            className="mt-4 text-white font-bold"
            onClick={() => refetchProfiles()}
          >
            Retry Loading Profiles
          </Button>
        </Card>
      </div>
    );
  }

  const safeBackendProfiles = backendProfiles || [];
  if (safeBackendProfiles.length === 0 || safeProfiles.length === 0) {
    return (
      <div className="max-w-md mx-auto py-12 text-center space-y-4 animate-fadeIn select-none">
        <Card className="p-6">
          <h4 className="text-sm font-bold text-slate-800">No Calibration Profiles Available</h4>
          <p className="text-xs text-slate-500 mt-2 font-medium">
            Please create or configure calibration profiles on the server first.
          </p>
          <Button
            type="button"
            variant="secondary"
            className="mt-4 font-bold bg-white"
            onClick={() => refetchProfiles()}
          >
            Retry
          </Button>
        </Card>
      </div>
    );
  }

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

  // Tolerances checks (guarded using optional chaining/safe defaults)
  const refTarget = activeProfile?.referenceTargetRaw ?? 0;
  const tolerance = activeProfile?.pressureToleranceRaw ?? 1000;
  const leftTarget = activeProfile?.leftBladderTargetAboveReferenceRaw ?? 0;
  const rightTarget = activeProfile?.rightBladderTargetAboveReferenceRaw ?? 0;
  const balanceTarget = activeProfile?.maxBalanceDifferenceRaw ?? 800;

  const refDiff = pressure0Raw != null ? pressure0Raw - refTarget : null;
  const refWithin = refDiff != null ? Math.abs(refDiff) <= tolerance : false;

  const leftDiff = leftEffectiveRaw != null ? leftEffectiveRaw - leftTarget : null;
  const leftWithin = leftDiff != null ? Math.abs(leftDiff) <= tolerance : false;

  const rightDiff = rightEffectiveRaw != null ? rightEffectiveRaw - rightTarget : null;
  const rightWithin = rightDiff != null ? Math.abs(rightDiff) <= tolerance : false;

  const balanceWithin = balanceDifferenceRaw != null ? balanceDifferenceRaw <= balanceTarget : false;

  const online = liveSummary?.online && !liveSummary?.offline && !liveSummary?.stale;

  const allTargetsMet =
    online &&
    !hasInvalidSensor &&
    pressure0Raw != null &&
    leftEffectiveRaw != null &&
    rightEffectiveRaw != null &&
    refWithin &&
    leftWithin &&
    rightWithin &&
    balanceWithin;

  function handleSavePressureSetup() {
    if (!allTargetsMet) {
      return;
    }
    setPressureSetupSaved(true);
    setActiveTab("readiness");
  }

  function updateActiveProfileField(field: keyof ChestPressureProfile, val: number) {
    if (!selectedProfileId) return;
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
                    {safeProfiles.map((p) => (
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

                  {showAdvanced && activeProfile && (
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
            {/* Offline Alert */}
            {!online && (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-700 font-bold space-y-1 animate-fadeIn">
                <div className="flex items-center gap-1.5">
                  <span>◰</span> Device is offline
                </div>
                <p className="text-[10px] text-slate-500 font-normal leading-relaxed">
                  The manikin is unreachable. Please connect and power on the device to start chest setup checks.
                </p>
              </div>
            )}

            {/* Sensor fault alert */}
            {online && hasInvalidSensor && (
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
                !online
                  ? "bg-slate-50 border-slate-100 opacity-60 text-slate-400"
                  : p0Invalid
                  ? "bg-rose-50/20 border-rose-100/80 text-rose-800"
                  : refWithin
                  ? "bg-emerald-50/20 border-emerald-100/80 text-emerald-800"
                  : "bg-amber-50/20 border-amber-100/80 text-amber-800"
              }`}
            >
              <div className="flex justify-between items-center">
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-400">Reference Chamber</span>
                {!online ? (
                  <span className="text-[10px] font-bold bg-slate-200 text-slate-500 px-2 py-0.5 rounded-full uppercase tracking-wider">Offline</span>
                ) : p0Invalid ? (
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
                    {!online || p0Invalid ? "—" : pressure0Raw != null ? String(pressure0Raw) : "Waiting"}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Target</span>
                  <span className="text-sm font-bold font-mono tracking-tight leading-none mt-1 text-slate-600 block">
                    {refTarget} ±{tolerance}
                  </span>
                </div>
              </div>
              <div className="text-xs font-semibold leading-relaxed mt-2 pt-2 border-t border-slate-100/30 text-slate-600">
                {!online
                  ? "Device offline."
                  : p0Invalid
                  ? "Sensor out of range."
                  : refDiff != null && refDiff < -tolerance
                  ? "Pump more air into the reference chamber."
                  : refDiff != null && refDiff > tolerance
                  ? "Release a little air from the reference chamber."
                  : "Reference chamber is in the target range."}
              </div>
            </div>

            {/* 2. Left Bladder */}
            <div
              className={`p-5 rounded-2xl border transition-all duration-300 flex flex-col justify-between gap-1.5 ${
                !online
                  ? "bg-slate-50 border-slate-100 opacity-60 text-slate-400"
                  : p1Invalid || p0Invalid
                  ? "bg-rose-50/20 border-rose-100/80 text-rose-800"
                  : leftWithin
                  ? "bg-emerald-50/20 border-emerald-100/80 text-emerald-800"
                  : "bg-amber-50/20 border-amber-100/80 text-amber-800"
              }`}
            >
              <div className="flex justify-between items-center">
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-400">Left Bladder</span>
                {!online ? (
                  <span className="text-[10px] font-bold bg-slate-200 text-slate-500 px-2 py-0.5 rounded-full uppercase tracking-wider">Offline</span>
                ) : p1Invalid || p0Invalid ? (
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
                    {!online || p1Invalid || p0Invalid ? "—" : leftEffectiveRaw != null ? String(leftEffectiveRaw) : "Waiting"}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Target</span>
                  <span className="text-sm font-bold font-mono tracking-tight leading-none mt-1 text-slate-600 block">
                    {leftTarget} ±{tolerance}
                  </span>
                </div>
              </div>
              <div className="text-xs font-semibold leading-relaxed mt-2 pt-2 border-t border-slate-100/30 text-slate-600">
                {!online
                  ? "Device offline."
                  : p1Invalid || p0Invalid
                  ? "Sensor out of range."
                  : leftDiff != null && leftDiff < -tolerance
                  ? "Pump more air into the left bladder."
                  : leftDiff != null && leftDiff > tolerance
                  ? "Release a little air from the left bladder."
                  : "Left bladder is in the target range."}
              </div>
            </div>

            {/* 3. Right Bladder */}
            <div
              className={`p-5 rounded-2xl border transition-all duration-300 flex flex-col justify-between gap-1.5 ${
                !online
                  ? "bg-slate-50 border-slate-100 opacity-60 text-slate-400"
                  : p2Invalid || p0Invalid
                  ? "bg-rose-50/20 border-rose-100/80 text-rose-800"
                  : rightWithin
                  ? "bg-emerald-50/20 border-emerald-100/80 text-emerald-800"
                  : "bg-amber-50/20 border-amber-100/80 text-amber-800"
              }`}
            >
              <div className="flex justify-between items-center">
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-400">Right Bladder</span>
                {!online ? (
                  <span className="text-[10px] font-bold bg-slate-200 text-slate-500 px-2 py-0.5 rounded-full uppercase tracking-wider">Offline</span>
                ) : p2Invalid || p0Invalid ? (
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
                    {!online || p2Invalid || p0Invalid ? "—" : rightEffectiveRaw != null ? String(rightEffectiveRaw) : "Waiting"}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Target</span>
                  <span className="text-sm font-bold font-mono tracking-tight leading-none mt-1 text-slate-600 block">
                    {rightTarget} ±{tolerance}
                  </span>
                </div>
              </div>
              <div className="text-xs font-semibold leading-relaxed mt-2 pt-2 border-t border-slate-100/30 text-slate-600">
                {!online
                  ? "Device offline."
                  : p2Invalid || p0Invalid
                  ? "Sensor out of range."
                  : rightDiff != null && rightDiff < -tolerance
                  ? "Pump more air into the right bladder."
                  : rightDiff != null && rightDiff > tolerance
                  ? "Release a little air from the right bladder."
                  : "Right bladder is in the target range."}
              </div>
            </div>

            {/* 4. Chest Balance */}
            <div
              className={`p-5 rounded-2xl border transition-all duration-300 flex flex-col justify-between gap-1.5 ${
                !online
                  ? "bg-slate-50 border-slate-100 opacity-60 text-slate-400"
                  : hasInvalidSensor
                  ? "bg-rose-50/20 border-rose-100/80 text-rose-800"
                  : balanceWithin
                  ? "bg-emerald-50/20 border-emerald-100/80 text-emerald-800"
                  : "bg-amber-50/20 border-amber-100/80 text-amber-800"
              }`}
            >
              <div className="flex justify-between items-center">
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-400">Chest Balance</span>
                {!online ? (
                  <span className="text-[10px] font-bold bg-slate-200 text-slate-500 px-2 py-0.5 rounded-full uppercase tracking-wider">Offline</span>
                ) : hasInvalidSensor ? (
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
                    {!online || hasInvalidSensor ? "—" : balanceDifferenceRaw != null ? String(balanceDifferenceRaw) : "Waiting"}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Max Target Difference</span>
                  <span className="text-sm font-bold font-mono tracking-tight leading-none mt-1 text-slate-600 block">
                    {balanceTarget}
                  </span>
                </div>
              </div>
              <div className="text-xs font-semibold leading-relaxed mt-2 pt-2 border-t border-slate-100/30 text-slate-600">
                {!online
                  ? "Device offline."
                  : hasInvalidSensor
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
        <DeviceReadinessPanel
          deviceId={deviceId}
          liveSummary={liveSummary}
          onContinue={onBack}
          continueLabel="Start Training Session"
          showBack={false}
        />
      )}
    </div>
  );
}

export function ManikinReadinessPage(props: ManikinReadinessPageProps) {
  return (
    <ErrorBoundary fallbackMessage="Failed to load the manikin readiness interface due to an application crash. Please try reloading.">
      <ManikinReadinessPageContent {...props} />
    </ErrorBoundary>
  );
}

export default ManikinReadinessPage;
