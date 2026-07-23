import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { type ManikinLiveSummary } from "../lib/browserManikinsApi";
import {
  createCalibrationProfile,
  deactivateCalibrationProfile,
  getCalibrationProfiles,
  getDefaultCalibrationProfile,
  setDefaultCalibrationProfile,
  updateCalibrationProfile,
  type CalibrationProfileRequest,
  type CalibrationProfileResponse,
} from "../lib/browserFirmwareApi";
import { getDeviceReadiness } from "../api/manikinsApi";
import type { CalibrationStartRequest, DeviceReadinessState } from "../types/manikin";

type CalibrationSettingsPanelProps = {
  devices: ManikinLiveSummary[];
  selectedDeviceId: string | null;
  onSelectedDeviceChange: (deviceId: string) => void;
  calibrationAction: "idle" | "starting" | "cancelling";
  onRunCalibration: (deviceId: string, payload: CalibrationStartRequest) => Promise<void>;
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

import CalibrationIcon from "./icons/CalibrationIcon";

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
  const [liveReadiness, setLiveReadiness] = useState<DeviceReadinessState | null>(null);

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
  const calibrationProgress = progressFromId(liveReadiness?.currentProgressId ?? null);
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
        const readiness = await getDeviceReadiness(selectedDeviceId);
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
      await onRunCalibration(selectedDeviceId, {
        profile_id: selectedProfile.profileId,
        hall_delta: selectedProfile.hallDelta,
        ref_pressure: selectedProfile.refPressure,
        bladder_1_pressure: selectedProfile.bladder1Pressure,
        bladder_2_pressure: selectedProfile.bladder2Pressure,
      });
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
  const saveButtonLabel = saveAcknowledged ? "Saved!" : savingState === "saving" ? "Saving..." : selectedProfile ? "Save Profile" : "Create Profile";

  return (
    <section style={getPanelStyle(Boolean(selectedProfile))}>
      <div style={headerStyle}>
        <div>
           <h2 style={titleStyle}>Calibration Settings <CalibrationIcon size={18} /></h2>
          <p style={subtitleStyle}>
            Edit local calibration profiles and run calibration against the selected live device.
          </p>
        </div>
        <button type="button" onClick={() => reloadProfiles(selectedProfileId)} disabled={loading || savingState !== "idle"} style={secondaryButtonStyle(loading || savingState !== "idle")}>
          {loading ? "Reloading..." : "Reload"}
        </button>
      </div>

      <div className="calibration-panel__pattern" aria-hidden="true" />

      <div style={gridStyle}>
        <label style={fieldStyle}>
          <span style={labelStyle}>Live Device</span>
          <select
            value={selectedDeviceId ?? ""}
            onChange={(event) => onSelectedDeviceChange(event.target.value)}
            disabled={devices.length === 0 || formDisabled}
            style={inputStyle}
          >
            {devices.length === 0 ? (
              <option value="">No live devices</option>
            ) : null}
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.deviceId}{device.online ? "" : " (offline)"}
              </option>
            ))}
          </select>
        </label>

        <label style={fieldStyle}>
          <span style={labelStyle}>Profile</span>
          <select
            value={selectedProfileId ?? ""}
            onChange={(event) => setSelectedProfileId(event.target.value || null)}
            disabled={profiles.length === 0 || formDisabled}
            style={inputStyle}
          >
            {selectedProfileId === null ? <option value="">New profile</option> : null}
            {profiles.map((profile) => (
              <option key={profile.profileId} value={profile.profileId}>
                {profile.name} {profile.defaultProfile ? "(default)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div style={infoRowStyle}>
        <span style={infoChipStyle}>Selected device: {selectedDeviceLabel}</span>
        <span style={infoChipStyle}>Selected profile: {selectedProfileLabel}</span>
        <span style={infoChipStyle}>{activeProfileCount} active profile(s)</span>
      </div>

      <div style={gridStyle}>
        <label style={{ ...fieldStyle, gridColumn: "1 / -1" }}>
          <span style={labelStyle}>Name</span>
          <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} disabled={formDisabled} style={inputStyle} placeholder="Adult Basic" />
        </label>

        {CALIBRATION_FIELDS.map((field) => {
          const value = form[field.key];
          const numericValue = Number(value) || 0;
          const percent = Math.max(0, Math.min(100, (numericValue / FIELD_MAX) * 100));

          return (
            <div key={field.key} style={fieldStyle}>
              <span style={labelStyle}>{field.label}</span>
              <div style={comboRowStyle}>
                <div style={fieldIconStyle}>{field.icon}</div>
                <input
                  value={value}
                  onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}
                  disabled={formDisabled}
                  style={numericInputStyle}
                  inputMode="numeric"
                  type="number"
                  min="1"
                  max={FIELD_MAX}
                />
              </div>
              <div style={gaugeTrackStyle} aria-hidden="true">
                <div style={{ ...gaugeFillStyle, width: `${percent}%` }} />
              </div>
            </div>
          );
        })}

        <label style={{ ...fieldStyle, gridColumn: "1 / -1" }}>
          <span style={labelStyle}>Description</span>
          <input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} disabled={formDisabled} style={inputStyle} placeholder="Optional description" />
        </label>
      </div>

      <div style={buttonRowStyle}>
        <button type="button" onClick={handleSaveProfile} disabled={loading || savingState !== "idle" || !formValidity.ok} className={`save-profile-button ${saveAcknowledged ? "save-profile-button--saved" : ""}`} style={primaryButtonStyle(loading || savingState !== "idle" || !formValidity.ok)}>
          {saveAcknowledged ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span aria-hidden="true">✓</span>
              Saved!
            </span>
          ) : (
            saveButtonLabel
          )}
        </button>
        <button type="button" onClick={handleSetDefault} disabled={loading || savingState !== "idle" || !selectedProfile || selectedProfile.defaultProfile} style={secondaryButtonStyle(loading || savingState !== "idle" || !selectedProfile || selectedProfile.defaultProfile)}>
          {savingState === "defaulting" ? "Setting..." : "Set Default"}
        </button>
        <button type="button" onClick={handleDeactivate} disabled={loading || savingState !== "idle" || !selectedProfile || !selectedProfile.active || selectedProfile.defaultProfile || activeProfileCount <= 1} style={secondaryButtonStyle(loading || savingState !== "idle" || !selectedProfile || !selectedProfile.active || selectedProfile.defaultProfile || activeProfileCount <= 1)}>
          {savingState === "deactivating" ? "Deactivating..." : "Deactivate"}
        </button>
        <button type="button" onClick={handleRunCalibration} disabled={!canRunCalibration} style={primaryButtonStyle(!canRunCalibration)}>
          {savingState === "running" || calibrationAction === "starting" ? "Requesting..." : "Run Calibration"}
        </button>
        <button type="button" onClick={handleNewProfile} disabled={loading || savingState !== "idle"} style={secondaryButtonStyle(loading || savingState !== "idle")}>
          New Profile
        </button>
      </div>

      {message ? <p style={messageStyle}>{message}</p> : null}
      {error ? <p style={errorStyle}>{error}</p> : null}
      {!formValidity.ok ? <p style={hintStyle}>{formValidity.message}</p> : null}

      {calibrationRunning ? (
        <div style={calibrationStatusStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={calibrationStatusLabelStyle}>Applying calibration – please wait</span>
            <span style={calibrationStatusValueStyle}>{Math.round(calibrationProgress)}%</span>
          </div>
          <div style={calibrationProgressTrackStyle}>
            <div style={{ ...calibrationProgressFillStyle, width: `${calibrationProgress}%` }} />
          </div>
        </div>
      ) : null}

      {selectedProfile ? (
        <p style={hintStyle}>
          Run Calibration uses the saved profile values for {selectedProfile.name}. Save edits before running if you changed any fields.
        </p>
      ) : (
        <p style={hintStyle}>Create or select a calibration profile before running calibration.</p>
      )}
    </section>
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
  if (hallDelta.value < 50 || hallDelta.value > 4095) {
    return { ok: false, message: "hallDelta must be between 50 and 4095" };
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

function buttonBaseStyle(disabled: boolean): CSSProperties {
  return {
    padding: "7px 12px",
    borderRadius: "8px",
    border: `1px solid ${disabled ? "#cbd5e1" : "#1d4ed8"}`,
    background: disabled ? "#e2e8f0" : "#1d4ed8",
    color: disabled ? "#64748b" : "#ffffff",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 700,
    fontSize: "0.84rem",
  };
}

function primaryButtonStyle(disabled: boolean): CSSProperties {
  return buttonBaseStyle(disabled);
}

function secondaryButtonStyle(disabled: boolean): CSSProperties {
  return {
    ...buttonBaseStyle(disabled),
    border: `1px solid ${disabled ? "#cbd5e1" : "#94a3b8"}`,
    background: disabled ? "#e2e8f0" : "#ffffff",
    color: disabled ? "#64748b" : "#334155",
  };
}

const panelStyle: CSSProperties = {
  border: "1px solid #cbd5e1",
  borderRadius: "12px",
  padding: "14px",
  background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
  display: "grid",
  gap: "12px",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "12px",
  flexWrap: "wrap",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "1rem",
  fontWeight: 800,
  color: "#0f172a",
};

const subtitleStyle: CSSProperties = {
  margin: "4px 0 0",
  fontSize: "0.86rem",
  color: "#475569",
  maxWidth: "58ch",
};

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "10px",
};

const fieldStyle: CSSProperties = {
  display: "grid",
  gap: "5px",
};

const labelStyle: CSSProperties = {
  fontSize: "0.76rem",
  fontWeight: 700,
  color: "#475569",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 10px",
  borderRadius: "8px",
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#0f172a",
  fontSize: "0.9rem",
};

const buttonRowStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
};

const infoRowStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
};

const infoChipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "5px 10px",
  borderRadius: "999px",
  background: "#e2e8f0",
  color: "#334155",
  fontSize: "0.78rem",
  fontWeight: 700,
};

const messageStyle: CSSProperties = {
  margin: 0,
  fontSize: "0.86rem",
  color: "#166534",
  fontWeight: 600,
};

const errorStyle: CSSProperties = {
  margin: 0,
  fontSize: "0.86rem",
  color: "#b91c1c",
  fontWeight: 600,
};

const hintStyle: CSSProperties = {
  margin: 0,
  fontSize: "0.82rem",
  color: "#64748b",
};

function progressFromId(progressId: number | null): number {
  if (progressId === null || progressId === undefined) {
    return 0;
  }

  return Math.max(0, Math.min(100, progressId));
}

const comboRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr)",
  gap: "8px",
  alignItems: "center",
};

const fieldIconStyle: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: "999px",
  display: "inline-grid",
  placeItems: "center",
  color: "#1d4ed8",
  background: "rgba(219, 234, 254, 0.9)",
  border: "1px solid rgba(147, 197, 253, 0.5)",
  flex: "none",
};

const numericInputStyle: CSSProperties = {
  ...inputStyle,
  minWidth: 0,
};

const gaugeTrackStyle: CSSProperties = {
  marginTop: 6,
  height: 8,
  borderRadius: 999,
  background: "rgba(226, 232, 240, 0.95)",
  overflow: "hidden",
};

const gaugeFillStyle: CSSProperties = {
  height: "100%",
  borderRadius: 999,
  background: "linear-gradient(90deg, #60a5fa 0%, #2563eb 100%)",
  transition: "width 180ms ease",
};

const calibrationStatusStyle: CSSProperties = {
  display: "grid",
  gap: 8,
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid rgba(37, 99, 235, 0.16)",
  background: "rgba(239, 246, 255, 0.95)",
};

const calibrationStatusLabelStyle: CSSProperties = {
  fontSize: "0.86rem",
  color: "#1e3a8a",
  fontWeight: 700,
};

const calibrationStatusValueStyle: CSSProperties = {
  fontSize: "0.8rem",
  color: "#1d4ed8",
  fontWeight: 800,
};

const calibrationProgressTrackStyle: CSSProperties = {
  height: 10,
  borderRadius: 999,
  background: "rgba(191, 219, 254, 0.8)",
  overflow: "hidden",
};

const calibrationProgressFillStyle: CSSProperties = {
  height: "100%",
  borderRadius: 999,
  background: "linear-gradient(90deg, #22c55e 0%, #2563eb 100%)",
  transition: "width 220ms ease",
};

function getPanelStyle(hasSelectedProfile: boolean): CSSProperties {
  return {
    borderRadius: "12px",
    padding: "14px",
    display: "grid",
    gap: "12px",
    position: "relative",
    overflow: "hidden",
    background:
      "radial-gradient(circle at top left, rgba(148, 163, 184, 0.12) 0 1px, transparent 1px) 0 0 / 14px 14px, linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
    border: hasSelectedProfile ? "1px solid transparent" : "1px solid #cbd5e1",
    boxShadow: hasSelectedProfile ? "0 0 0 1px rgba(96, 165, 250, 0.22), 0 16px 40px rgba(37, 99, 235, 0.08)" : "0 10px 24px rgba(15, 23, 42, 0.05)",
    backgroundClip: hasSelectedProfile ? "padding-box, border-box" : undefined,
    backgroundOrigin: hasSelectedProfile ? "padding-box, border-box" : undefined,
    backgroundImage: hasSelectedProfile
      ? "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%), linear-gradient(135deg, rgba(59, 130, 246, 0.85), rgba(34, 197, 94, 0.55))"
      : undefined,
  };
}
