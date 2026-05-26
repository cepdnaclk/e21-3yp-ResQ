import React, { useEffect, useState } from "react";
import { getCalibrationProgress } from "../lib/calibrationApi";

type Field = {
  key: string;
  label: string;
  max: number;
  icon?: React.ReactNode;
};

const FIELDS: Field[] = [
  { key: "pressure", label: "Pressure (g)", max: 200, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2v20" stroke="#0f172a" strokeWidth="1.5" strokeLinecap="round"/></svg> },
  { key: "hall", label: "Hall offset", max: 100, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#0f172a" strokeWidth="1.5"/></svg> },
  { key: "sensitivity", label: "Sensitivity", max: 200, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 12h18" stroke="#0f172a" strokeWidth="1.5" strokeLinecap="round"/></svg> },
];

export default function CalibrationSettings({ profileSelected }: { profileSelected?: boolean }) {
  const [values, setValues] = useState<Record<string, number>>(() => {
    const base: Record<string, number> = {};
    FIELDS.forEach((f) => (base[f.key] = Math.round(f.max / 2)));
    return base;
  });

  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const [calibrationRunning, setCalibrationRunning] = useState(false);
  const [progressId, setProgressId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let t: number | undefined;
    const activeProgressId = progressId;

    if (!calibrationRunning || activeProgressId === null) {
      return () => { if (t) window.clearTimeout(t); };
    }

    async function poll() {
      try {
        const p = await getCalibrationProgress(activeProgressId!);
        setProgress(p);
        if (p >= 100) {
          setCalibrationRunning(false);
          return;
        }
      } catch (e) {
        // ignore
      } finally {
        t = window.setTimeout(poll, 1200) as unknown as number;
      }
    }

    void poll();

    return () => { if (t) window.clearTimeout(t); };
  }, [calibrationRunning, progressId]);

  function onChangeField(key: string, v: number) {
    setValues((cur) => ({ ...cur, [key]: Math.max(0, Math.min((FIELDS.find(f=>f.key===key)?.max)||200, Math.round(v))) }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      // TODO: call actual save API to persist profile
      await new Promise((r) => setTimeout(r, 500));
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1500);
    } finally {
      setSaving(false);
    }
  }

  function startCalibration() {
    setCalibrationRunning(true);
    // In a real flow we would start calibration on backend and receive a progressId
    const id = `demo-${Date.now()}`;
    setProgressId(id);
    setProgress(0);
  }

  return (
    <div className={`card calibration-card ${profileSelected ? "calibration-card--selected" : ""}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <p className="network-card__eyebrow">Calibration</p>
          <h3 className="network-card__title">Calibration Settings</h3>
        </div>
        <div>
          <button className={`button ${savedFlash ? "button--success" : "button--primary"}`} onClick={handleSave} disabled={saving}>
            {savedFlash ? "✓ Saved!" : saving ? "Saving..." : "Save Profile"}
          </button>
        </div>
      </div>

      <div style={{ marginTop: 12, position: "relative", padding: 12 }}>
        <div className="calibration-bg-pattern" aria-hidden />

        <div style={{ display: "grid", gap: 14 }}>
          {FIELDS.map((f) => (
            <div key={f.key} style={{ display: "grid", gap: 8 }}>
              <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ width: 20 }}>{f.icon}</span>
                  <span style={{ fontWeight: 700 }}>{f.label}</span>
                </div>
                <div style={{ minWidth: 80 }}>
                  <input type="number" value={values[f.key]} onChange={(e) => onChangeField(f.key, Number(e.target.value))} style={{ width: 72, padding: "6px 8px", borderRadius: 8, border: "1px solid #d1d5db" }} />
                </div>
              </label>

              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <input type="range" min={0} max={f.max} value={values[f.key]} onChange={(e) => onChangeField(f.key, Number(e.target.value))} style={{ flex: 1 }} />
                <div style={{ width: 140, height: 12, background: "#e6eefc", borderRadius: 6, overflow: "hidden" }}>
                  <div style={{ width: `${(values[f.key]/f.max)*100}%`, height: "100%", background: "linear-gradient(90deg,#60a5fa,#06b6d4)" }} />
                </div>
              </div>
            </div>
          ))}

          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button className="button button--primary" onClick={startCalibration} disabled={calibrationRunning}>Run Calibration</button>
            {calibrationRunning ? (
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: "0.9rem", color: "#334155" }}>Applying calibration – please wait</p>
                <div style={{ height: 10, background: "#f1f5f9", borderRadius: 8, overflow: "hidden", marginTop: 8 }}>
                  <div style={{ width: `${progress}%`, height: "100%", background: "linear-gradient(90deg,#34d399,#06b6d4)", transition: "width 900ms linear" }} />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
