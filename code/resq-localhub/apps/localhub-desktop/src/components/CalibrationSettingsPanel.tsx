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
  type FirmwareCalibrationStartPayload,
} from "../lib/browserFirmwareApi";

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

const blankForm: FormState = {
  name: "",
  hallDelta: "",
  refPressure: "",
  bladder1Pressure: "",
  bladder2Pressure: "",
  description: "",
};

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
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

        const keepSelection = preferredProfileId && allProfiles.some((profile) => profile.profileId === preferredProfileId)
          ? preferredProfileId
          : selectedProfileId && allProfiles.some((profile) => profile.profileId === selectedProfileId)
            ? selectedProfileId
            : defaultProfile?.profileId
              ?? allProfiles.find((profile) => profile.defaultProfile && profile.active)?.profileId
              ?? allProfiles.find((profile) => profile.active)?.profileId
              ?? allProfiles[0]?.profileId
              ?? null;

        setSelectedProfileId(keepSelection);
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
    <section style={panelStyle}>
      <div style={headerStyle}>
        <div>
          <h2 style={titleStyle}>Calibration Settings</h2>
          <p style={subtitleStyle}>
            Edit local calibration profiles and run calibration against the selected live device.
          </p>
        </div>
        <button type="button" onClick={() => reloadProfiles(selectedProfileId)} disabled={loading || savingState !== "idle"} style={secondaryButtonStyle(loading || savingState !== "idle")}>
          {loading ? "Reloading..." : "Reload"}
        </button>
      </div>

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
        <label style={fieldStyle}>
          <span style={labelStyle}>Name</span>
          <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} disabled={formDisabled} style={inputStyle} placeholder="Adult Basic" />
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>Hall Delta</span>
          <input value={form.hallDelta} onChange={(event) => setForm((current) => ({ ...current, hallDelta: event.target.value }))} disabled={formDisabled} style={inputStyle} inputMode="numeric" type="number" min="50" max="4095" />
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>Reference Pressure</span>
          <input value={form.refPressure} onChange={(event) => setForm((current) => ({ ...current, refPressure: event.target.value }))} disabled={formDisabled} style={inputStyle} inputMode="numeric" type="number" min="1" />
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>Bladder 1 Pressure</span>
          <input value={form.bladder1Pressure} onChange={(event) => setForm((current) => ({ ...current, bladder1Pressure: event.target.value }))} disabled={formDisabled} style={inputStyle} inputMode="numeric" type="number" min="1" />
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>Bladder 2 Pressure</span>
          <input value={form.bladder2Pressure} onChange={(event) => setForm((current) => ({ ...current, bladder2Pressure: event.target.value }))} disabled={formDisabled} style={inputStyle} inputMode="numeric" type="number" min="1" />
        </label>
        <label style={{ ...fieldStyle, gridColumn: "1 / -1" }}>
          <span style={labelStyle}>Description</span>
          <input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} disabled={formDisabled} style={inputStyle} placeholder="Optional description" />
        </label>
      </div>

      <div style={buttonRowStyle}>
        <button type="button" onClick={handleSaveProfile} disabled={loading || savingState !== "idle" || !formValidity.ok} style={primaryButtonStyle(loading || savingState !== "idle" || !formValidity.ok)}>
          {savingState === "saving" ? "Saving..." : selectedProfile ? "Save Profile" : "Create Profile"}
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
