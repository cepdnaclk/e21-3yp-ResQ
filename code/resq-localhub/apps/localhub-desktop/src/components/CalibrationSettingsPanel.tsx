import { useEffect, useMemo, useState } from "react";
import { type ManikinLiveSummary } from "../lib/browserManikinsApi";
import {
  createCalibrationProfile,
  deactivateCalibrationProfile,
  getCalibrationProfiles,
  getDefaultCalibrationProfile,
  getReadiness,
  setDefaultCalibrationProfile,
  updateCalibrationProfile,
  type CalibrationProfileRequest,
  type CalibrationProfileResponse,
  type FirmwareCalibrationStartPayload,
  type FirmwareReadinessResponse,
} from "../lib/browserFirmwareApi";
import { Card, Button, Badge, Input, Select, Progress } from "./ui";
import { RefreshCw } from "lucide-react";

type CalibrationSettingsPanelProps = {
  devices: ManikinLiveSummary[];
  selectedDeviceId: string | null;
  onSelectedDeviceChange: (deviceId: string) => void;
  calibrationAction: "idle" | "starting" | "cancelling";
  onRunCalibration: (deviceId: string, payload: FirmwareCalibrationStartPayload) => Promise<void>;
};

type FormState = {
  name: string;
  hallDelta: string;
  refPressure: string;
  bladder1Pressure: string;
  bladder2Pressure: string;
  description: string;
};

type FieldConfig = {
  key: keyof Pick<FormState, "hallDelta" | "refPressure" | "bladder1Pressure" | "bladder2Pressure">;
  label: string;
  icon: React.ReactNode;
};

const blankForm: FormState = {
  name: "",
  hallDelta: "",
  refPressure: "",
  bladder1Pressure: "",
  bladder2Pressure: "",
  description: "",
};

const FIELD_MAX = 200;

const CALIBRATION_FIELDS: FieldConfig[] = [
  {
    key: "hallDelta",
    label: "Hall Delta",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M2 7h2M10 7h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M4.25 7a2.75 2.75 0 1 1 5.5 0 2.75 2.75 0 1 1-5.5 0Z" stroke="currentColor" strokeWidth="1.2" />
        <path d="M7 4.8v1.75" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: "refPressure",
    label: "Reference Pressure",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M7 2.5a4.5 4.5 0 1 0 4.5 4.5H9.4a2.4 2.4 0 1 1-2.4-2.4V2.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M7 7l2.2-1.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: "bladder1Pressure",
    label: "Bladder 1 Pressure",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <rect x="2.2" y="3" width="9.6" height="8" rx="2" stroke="currentColor" strokeWidth="1.2" />
        <path d="M4 6h6M4 8h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: "bladder2Pressure",
    label: "Bladder 2 Pressure",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M3 10V6.5A4 4 0 0 1 7 2.5h1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M8.5 2.5 9.8 3.8 8.5 5.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="3" y="6.5" width="8" height="5" rx="2" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    ),
  },
];

export function CalibrationSettingsPanel({
  devices,
  selectedDeviceId,
  onSelectedDeviceChange,
  calibrationAction,
  onRunCalibration,
}: CalibrationSettingsPanelProps) {
  const [profiles, setProfiles] = useState<CalibrationProfileResponse[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [loading, setLoading] = useState(true);
  const [savingState, setSavingState] = useState<"idle" | "saving" | "defaulting" | "deactivating" | "running">("idle");
  const [saveAcknowledged, setSaveAcknowledged] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveReadiness, setLiveReadiness] = useState<FirmwareReadinessResponse | null>(null);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.profileId === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );

  const selectedDevice = useMemo(
    () => devices.find((device) => device.deviceId === selectedDeviceId) ?? null,
    [devices, selectedDeviceId],
  );

  const activeProfileCount = profiles.filter((profile) => profile.active).length;
  const formValidity = validateForm(form);
  const calibrationProgress = progressFromId(liveReadiness?.progressId ?? null);
  const calibrationRunning = liveReadiness?.firmwareState === "CALIBRATING";
  const canRunCalibration = Boolean(
    selectedDeviceId &&
    selectedProfile &&
    selectedProfile.active &&
    formValidity.ok &&
    calibrationAction === "idle" &&
    savingState === "idle" &&
    !loading,
  );

  useEffect(() => {
    let cancelled = false;

    async function loadProfiles(preferredProfileId?: string | null) {
      setLoading(true);
      setError(null);

      try {
        const [allProfiles, defaultProfile] = await Promise.all([
          getCalibrationProfiles(),
          getDefaultCalibrationProfile(),
        ]);
        if (cancelled) {
          return;
        }

        setProfiles(allProfiles);

        const nextSelection = preferredProfileId && allProfiles.some((profile) => profile.profileId === preferredProfileId)
          ? preferredProfileId
          : selectedProfileId && allProfiles.some((profile) => profile.profileId === selectedProfileId)
            ? selectedProfileId
            : defaultProfile?.profileId
              ?? allProfiles.find((profile) => profile.defaultProfile && profile.active)?.profileId
              ?? allProfiles.find((profile) => profile.active)?.profileId
              ?? allProfiles[0]?.profileId
              ?? null;

        setSelectedProfileId(nextSelection);
        setMessage(allProfiles.length === 0 ? "No calibration profiles found." : `Loaded ${allProfiles.length} calibration profile(s).`);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load calibration profiles.");
          setProfiles([]);
          setSelectedProfileId(null);
          setForm(blankForm);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadProfiles();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (profiles.length === 0) {
      setForm(blankForm);
      return;
    }

    const profile = profiles.find((entry) => entry.profileId === selectedProfileId);
    if (!profile) {
      return;
    }

    setForm({
      name: profile.name,
      hallDelta: String(profile.hallDelta),
      refPressure: String(profile.refPressure),
      bladder1Pressure: String(profile.bladder1Pressure),
      bladder2Pressure: String(profile.bladder2Pressure),
      description: profile.description ?? "",
    });
  }, [profiles, selectedProfileId]);

  useEffect(() => {
    if (selectedDeviceId) {
      const selectedStillExists = devices.some((device) => device.deviceId === selectedDeviceId);
      if (selectedStillExists) {
        return;
      }
    }

    const firstDevice = devices[0]?.deviceId ?? null;
    if (firstDevice && firstDevice !== selectedDeviceId) {
      onSelectedDeviceChange(firstDevice);
    }
  }, [devices, onSelectedDeviceChange, selectedDeviceId]);

  useEffect(() => {
    let cancelled = false;

    async function pollReadiness() {
      if (!selectedDeviceId) {
        setLiveReadiness(null);
        return;
      }

      try {
        const readiness = await getReadiness(selectedDeviceId);
        if (!cancelled) {
          setLiveReadiness(readiness);
        }
      } catch {
        if (!cancelled) {
          setLiveReadiness(null);
        }
      }
    }

    void pollReadiness();
    const interval = window.setInterval(pollReadiness, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [selectedDeviceId]);

  useEffect(() => {
    if (!saveAcknowledged) {
      return;
    }

    const timer = window.setTimeout(() => setSaveAcknowledged(false), 1500);
    return () => window.clearTimeout(timer);
  }, [saveAcknowledged]);

  async function reloadProfiles(preferredProfileId?: string | null) {
    setLoading(true);
    setError(null);

    try {
      const [allProfiles, defaultProfile] = await Promise.all([
        getCalibrationProfiles(),
        getDefaultCalibrationProfile(),
      ]);

      setProfiles(allProfiles);

      const nextSelection = preferredProfileId && allProfiles.some((profile) => profile.profileId === preferredProfileId)
        ? preferredProfileId
        : selectedProfileId && allProfiles.some((profile) => profile.profileId === selectedProfileId)
          ? selectedProfileId
          : defaultProfile?.profileId
            ?? allProfiles.find((profile) => profile.defaultProfile && profile.active)?.profileId
            ?? allProfiles.find((profile) => profile.active)?.profileId
            ?? allProfiles[0]?.profileId
            ?? null;

      setSelectedProfileId(nextSelection);
      setMessage(`Loaded ${allProfiles.length} calibration profile(s).`);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load calibration profiles.");
    } finally {
      setLoading(false);
    }
  }

  function buildRequest(): CalibrationProfileRequest | null {
    const validation = validateForm(form);
    if (!validation.ok) {
      setError(validation.message);
      return null;
    }

    const name = form.name.trim();
    return {
      name,
      hallDelta: validation.hallDelta,
      refPressure: validation.refPressure,
      bladder1Pressure: validation.bladder1Pressure,
      bladder2Pressure: validation.bladder2Pressure,
      description: form.description.trim() ? form.description.trim() : null,
      active: selectedProfile?.active ?? true,
      defaultProfile: selectedProfile?.defaultProfile ?? false,
    };
  }

  async function handleSaveProfile() {
    const request = buildRequest();
    if (!request) {
      return;
    }

    setSavingState("saving");
    setError(null);
    setMessage(null);

    try {
      const response = selectedProfile
        ? await updateCalibrationProfile(selectedProfile.profileId, request)
        : await createCalibrationProfile(request);
      await reloadProfiles(response.profileId);
      setSaveAcknowledged(true);
      setMessage(`Saved calibration profile ${response.name}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save calibration profile.");
    } finally {
      setSavingState("idle");
    }
  }

  async function handleSetDefault() {
    if (!selectedProfile) {
      setError("Select a calibration profile first.");
      return;
    }

    setSavingState("defaulting");
    setError(null);
    setMessage(null);

    try {
      const response = await setDefaultCalibrationProfile(selectedProfile.profileId);
      await reloadProfiles(response.profileId);
      setMessage(`Set ${response.name} as the default calibration profile.`);
    } catch (defaultError) {
      setError(defaultError instanceof Error ? defaultError.message : "Failed to set default calibration profile.");
    } finally {
      setSavingState("idle");
    }
  }

  async function handleDeactivate() {
    if (!selectedProfile) {
      setError("Select a calibration profile first.");
      return;
    }

    setSavingState("deactivating");
    setError(null);
    setMessage(null);

    try {
      const response = await deactivateCalibrationProfile(selectedProfile.profileId);
      await reloadProfiles(response.profileId);
      setMessage(`Deactivated calibration profile ${response.name}.`);
    } catch (deactivateError) {
      setError(deactivateError instanceof Error ? deactivateError.message : "Failed to deactivate calibration profile.");
    } finally {
      setSavingState("idle");
    }
  }

  async function handleRunCalibration() {
    if (!selectedDeviceId || !selectedProfile) {
      setError("Select a live device and calibration profile first.");
      return;
    }

    if (!formValidity.ok) {
      setError(formValidity.message);
      return;
    }

    setSavingState("running");
    setError(null);
    setMessage(null);

    try {
      await onRunCalibration(selectedDeviceId, { profileId: selectedProfile.profileId });
      setMessage(`Requested calibration for ${selectedDeviceId} using ${selectedProfile.name}.`);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Failed to start calibration.");
    } finally {
      setSavingState("idle");
    }
  }

  async function handleNewProfile() {
    setSelectedProfileId(null);
    setForm(blankForm);
    setMessage("Editing a new calibration profile.");
    setError(null);
  }

  const formDisabled = loading || savingState !== "idle";
  const selectedDeviceLabel = selectedDevice ? `${selectedDevice.deviceId}${selectedDevice.online ? "" : " (offline)"}` : "No live device selected";
  const selectedProfileLabel = selectedProfile ? selectedProfile.name : "New profile";

  return (
    <Card className="mb-6 relative overflow-hidden" style={{ marginTop: "-12px" }}>
      <div className="flex justify-between items-center mb-6 calibration-panel-header">
        <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
          <span className="text-sm font-semibold uppercase tracking-wider">Configuration Profile</span>
        </div>
        <Button
          variant="secondary"
          onClick={() => reloadProfiles(selectedProfileId)}
          disabled={loading || savingState !== "idle"}
          className="h-8 w-8 p-0 flex items-center justify-center btn-reload"
          aria-label="Reload profiles"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Live Device</label>
          <Select
            value={selectedDeviceId ?? ""}
            onChange={(event) => onSelectedDeviceChange(event.target.value)}
            disabled={devices.length === 0 || formDisabled}
            className="w-full bg-white dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600"
          >
            {devices.length === 0 ? <option value="">No live devices</option> : null}
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId} className="dark:bg-gray-800">
                {device.deviceId} {device.online ? "(Online)" : "(Offline)"}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Profile</label>
          <Select
            value={selectedProfileId ?? ""}
            onChange={(event) => setSelectedProfileId(event.target.value || null)}
            disabled={profiles.length === 0 || formDisabled}
            className="w-full bg-white dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600"
          >
            {selectedProfileId === null ? <option value="">New profile</option> : null}
            {profiles.map((profile) => (
              <option key={profile.profileId} value={profile.profileId} className="dark:bg-gray-800">
                {profile.name} {profile.defaultProfile ? "(default)" : ""}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2.5 mb-6">
        <Badge variant="default" className="badge-device bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 font-medium">
          Device: {selectedDeviceLabel}
        </Badge>
        <Badge variant="default" className="badge-profile bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 font-medium">
          Profile: {selectedProfileLabel}
        </Badge>
        <Badge variant="default" className="badge-active-count bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 font-medium">
          {activeProfileCount} active profile(s)
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Name</label>
          <Input
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            disabled={formDisabled}
            placeholder="Adult Basic"
            className="bg-white dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Description</label>
          <Input
            value={form.description}
            onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            disabled={formDisabled}
            placeholder="Optional description"
            className="bg-white dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600"
          />
        </div>
      </div>

      <details className="group border border-gray-200 dark:border-gray-700 rounded-xl p-4 mb-6 bg-gray-50 dark:bg-gray-900/40">
        <summary className="text-sm font-bold text-[#005A9C] dark:text-blue-400 cursor-pointer select-none flex items-center justify-between list-none focus:outline-none">
          <span>Advanced Settings</span>
          <span className="transition-transform group-open:rotate-180 text-xs">▼</span>
        </summary>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          {CALIBRATION_FIELDS.map((field) => {
            const value = form[field.key];
            const numericValue = Number(value) || 0;
            const percent = Math.max(0, Math.min(100, (numericValue / FIELD_MAX) * 100));

            return (
              <div key={field.key} className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{field.label}</span>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-[#005A9C] dark:text-blue-400 border border-blue-100 dark:border-blue-800 flex-shrink-0">
                    {field.icon}
                  </div>
                  <Input
                    value={value}
                    onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}
                    disabled={formDisabled}
                    className="w-full bg-white dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600"
                    inputMode="numeric"
                    type="number"
                    min="1"
                    max={FIELD_MAX}
                  />
                </div>
                {/* Visual Gauge */}
                <div className="h-1.5 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mt-1">
                  <div className="h-full bg-gradient-to-r from-blue-400 to-[#005A9C] transition-all duration-300" style={{ width: `${percent}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </details>

      <div className="flex flex-wrap gap-3 mb-6 calibration-action-buttons">
        <Button
          onClick={handleSaveProfile}
          disabled={loading || savingState !== "idle" || !formValidity.ok}
          className={saveAcknowledged ? "btn-save-profile success" : "btn-save-profile"}
        >
          {saveAcknowledged ? "Saved!" : savingState === "saving" ? "Saving..." : selectedProfile ? "Save Profile" : "Create Profile"}
        </Button>
        <Button
          variant="secondary"
          onClick={handleSetDefault}
          disabled={loading || savingState !== "idle" || !selectedProfile || selectedProfile.defaultProfile}
          className="btn-set-default"
        >
          {savingState === "defaulting" ? "Setting..." : "Set Default"}
        </Button>
        <Button
          variant="secondary"
          onClick={handleDeactivate}
          disabled={loading || savingState !== "idle" || !selectedProfile || !selectedProfile.active || selectedProfile.defaultProfile || activeProfileCount <= 1}
          className="btn-deactivate"
        >
          {savingState === "deactivating" ? "Deactivating..." : "Deactivate"}
        </Button>
        <Button
          onClick={handleRunCalibration}
          disabled={!canRunCalibration}
          className="btn-run-calibration"
        >
          {savingState === "running" || calibrationAction === "starting" ? "Requesting..." : "Run Calibration"}
        </Button>
        <Button
          variant="secondary"
          onClick={handleNewProfile}
          disabled={loading || savingState !== "idle"}
          className="btn-new-profile"
        >
          New Profile
        </Button>
      </div>

      {message ? <p className="text-sm font-semibold text-[#107C10] mt-1">{message}</p> : null}
      {error ? <p className="text-sm font-semibold text-[#D13438] mt-1">{error}</p> : null}
      {!formValidity.ok ? <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{formValidity.message}</p> : null}

      {calibrationRunning ? (
        <div className="border border-blue-100 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10 rounded-xl p-4 mt-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-bold text-blue-800 dark:text-blue-300">Applying calibration – please wait</span>
            <span className="text-sm font-extrabold text-[#005A9C] dark:text-blue-400">{Math.round(calibrationProgress)}%</span>
          </div>
          <Progress value={calibrationProgress} className="h-2 bg-blue-100 dark:bg-blue-950" />
        </div>
      ) : null}

      {selectedProfile ? (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
          Run Calibration uses the saved profile values for {selectedProfile.name}. Save edits before running if you changed any fields.
        </p>
      ) : (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">Create or select a calibration profile before running calibration.</p>
      )}
    </Card>
  );
}

function validateForm(form: FormState): { ok: true; hallDelta: number; refPressure: number; bladder1Pressure: number; bladder2Pressure: number } | { ok: false; message: string } {
  const name = form.name.trim();
  if (!name) {
    return { ok: false, message: "name is required" };
  }

  const hallDelta = parsePositive(form.hallDelta, "hallDelta must be greater than 0");
  if (!hallDelta.ok) {
    return hallDelta;
  }

  const refPressure = parsePositive(form.refPressure, "refPressure must be greater than 0");
  if (!refPressure.ok) {
    return refPressure;
  }

  const bladder1Pressure = parsePositive(form.bladder1Pressure, "bladder1Pressure must be greater than 0");
  if (!bladder1Pressure.ok) {
    return bladder1Pressure;
  }

  const bladder2Pressure = parsePositive(form.bladder2Pressure, "bladder2Pressure must be greater than 0");
  if (!bladder2Pressure.ok) {
    return bladder2Pressure;
  }

  return {
    ok: true,
    hallDelta: hallDelta.value,
    refPressure: refPressure.value,
    bladder1Pressure: bladder1Pressure.value,
    bladder2Pressure: bladder2Pressure.value,
  };
}

function parsePositive(value: string, message: string): { ok: true; value: number } | { ok: false; message: string } {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { ok: false, message };
  }

  return { ok: true, value: parsed };
}

function progressFromId(progressId: number | null): number {
  if (progressId === null || progressId === undefined) {
    return 0;
  }

  return Math.max(0, Math.min(100, progressId));
}
