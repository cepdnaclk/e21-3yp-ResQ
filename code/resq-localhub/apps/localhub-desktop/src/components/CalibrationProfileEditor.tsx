import { useState } from "react";
import type { CalibrationProfileRequest, CalibrationProfileResponse } from "../types/firmware";

const fields = [
  ["hallDelta", "Hall Delta", 50, 4095],
  ["refPressure", "Reference Pressure", 1, undefined],
  ["bladder1Pressure", "Bladder 1 Pressure", 1, undefined],
  ["bladder2Pressure", "Bladder 2 Pressure", 1, undefined],
] as const;

export default function CalibrationProfileEditor({ profile, disabled, saving, onSave, onCancel }: {
  profile: CalibrationProfileResponse | null;
  disabled: boolean;
  saving: boolean;
  onSave: (request: CalibrationProfileRequest) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(profile?.name ?? "");
  const [description, setDescription] = useState(profile?.description ?? "");
  const [values, setValues] = useState(Object.fromEntries(fields.map(([key]) => [key, String(profile?.[key] ?? "")])));
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (disabled) return;
    if (!name.trim()) { setError("Profile name is required."); return; }
    for (const [key, label, min, max] of fields) {
      const value = Number(values[key]);
      if (!Number.isSafeInteger(value) || value < min || (max !== undefined && value > max)) {
        setError(`${label} must be an integer ${max ? `between ${min} and ${max}` : "greater than 0"}.`);
        return;
      }
    }
    setError(null);
    await onSave({ name: name.trim(), description: description.trim(), active: true,
      hallDelta: Number(values.hallDelta), refPressure: Number(values.refPressure),
      bladder1Pressure: Number(values.bladder1Pressure), bladder2Pressure: Number(values.bladder2Pressure) });
  }
  return <form onSubmit={submit} noValidate className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
    <h3 className="font-bold">{profile ? "Edit Profile" : "New Profile"}</h3>
    <p className="text-sm">Save this profile before starting calibration.</p>
    <fieldset disabled={disabled} className="grid grid-cols-2 gap-3">
      <label className="col-span-2">Profile Name<input className="block w-full rounded border p-2" value={name} onChange={e => setName(e.target.value)} required /></label>
      {fields.map(([key, label, min, max]) => <label key={key}>{label}<input className="block w-full rounded border p-2" type="number" min={min} max={max} step={1} value={values[key]} onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))} required /></label>)}
      <label className="col-span-2">Description (optional)<textarea className="block w-full rounded border p-2" value={description} onChange={e => setDescription(e.target.value)} /></label>
    </fieldset>
    {error && <p role="alert" className="text-rose-700">{error}</p>}
    <div className="flex gap-3"><button className="rounded-lg border border-slate-300 px-4 py-2 disabled:opacity-50" type="button" onClick={onCancel} disabled={saving}>Cancel</button><button className="rounded-lg bg-teal-700 px-4 py-2 text-white disabled:opacity-50" type="submit" disabled={disabled}>{saving ? "Saving Profile…" : profile ? "Save Profile" : "Create Profile"}</button></div>
  </form>;
}
