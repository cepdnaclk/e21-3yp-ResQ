import React, { useMemo, useState } from "react";
import { ManikinInventoryEntry } from "../lib/browserManikinsApi";
import ReadinessBlock from "./ReadinessBlock";

type Props = { entry: ManikinInventoryEntry };

function parseCalibrationProgress(raw?: string | null): number {
  if (!raw) return 0;
  // expect formats like 'CALIBRATING:45' or 'calibrating:45'
  const m = raw.match(/calibrat(?:ing)?[:=]?\s*(\d{1,3})/i);
  if (m && m[1]) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) return Math.max(0, Math.min(100, n));
  }
  return 0;
}

function seededRandom(seed: string, i: number) {
  let h = 2166136261 >>> 0;
  for (let j = 0; j < seed.length; j++) {
    h = Math.imul(h ^ seed.charCodeAt(j), 16777619);
  }
  h = Math.imul(h ^ i, 16777619) >>> 0;
  return ((h >>> 0) % 100) / 100;
}

export default function DeviceCard({ entry }: Props) {
  const [open, setOpen] = useState(false);
  const progress = useMemo(() => parseCalibrationProgress(entry.rawStatus ?? entry.state ?? null), [entry.rawStatus, entry.state]);

  const sparklinePoints = useMemo(() => {
    const pts: number[] = [];
    for (let i = 0; i < 8; i++) pts.push(20 + Math.round(seededRandom(entry.deviceId, i) * 60));
    return pts;
  }, [entry.deviceId]);

  return (
    <article className={`device-card card ${open ? "device-card--open" : ""}`}>
      <div className="device-card__row">
        <div className="device-card__meta">
          <div className={`device-status-dot ${entry.status === "paired" || entry.status === "online" ? "device-status-dot--ready" : ""}`} aria-hidden />
          <div>
            <p className="device-id">{entry.deviceId}</p>
            <div className="device-chips">
              <span className="chip"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M12 2v20" stroke="#0f172a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> {entry.ip ?? "No IP"}</span>
              <span className="chip"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M3 12h18" stroke="#0f172a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> {entry.fw ?? "No FW"}</span>
              <span className="chip"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M12 3v18" stroke="#0f172a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> {entry.status}</span>
            </div>
          </div>
        </div>

        <div className="device-card__stats">
          <div className="sparkline" aria-hidden>
            <svg width="80" height="28" viewBox="0 0 80 28" preserveAspectRatio="none">
              <polyline fill="none" stroke="#0f172a" strokeWidth="1.2" points={sparklinePoints.map((v, i) => `${(i/7)*80},${28 - v/100*28}`).join(" ")} strokeOpacity="0.7" />
            </svg>
          </div>

          {progress > 0 || entry.rawStatus?.toLowerCase().includes("calibrat") ? (
            <div className="calibration">
              <svg className="ring" viewBox="0 0 36 36">
                <path className="ring-bg" d="M18 2a16 16 0 1 1 0 32a16 16 0 1 1 0-32" fill="none" stroke="#e6eefc" strokeWidth="4" />
                <path className="ring-fg" d="M18 2a16 16 0 1 1 0 32a16 16 0 1 1 0-32" fill="none" stroke="#06b6d4" strokeWidth="4" strokeDasharray={`${progress},100`} strokeLinecap="round" />
                <text x="18" y="20" textAnchor="middle" fontSize="6" fill="#0f172a">{progress}%</text>
              </svg>
            </div>
          ) : null}
        </div>
      </div>

      <div className="device-card__body">
        <p className="device-detail">State: {entry.rawStatus ?? entry.state ?? "unknown"} • Last seen: {entry.lastSeen ?? "never"}</p>
        <div className="device-actions">
          <button className="button button--ghost" onClick={() => setOpen((v) => !v)}>{open ? "Hide details" : "Show details"}</button>
        </div>
      </div>

      {/* Readiness block inserted below stats */}
      <div style={{ marginTop: 10 }}>
        <ReadinessBlock
          readyForSession={entry.online && !entry.rawStatus?.toLowerCase().includes("calibrat")}
          progressPercent={progress}
          progressId={entry.deviceId}
          reasonId={entry.rawStatus ?? null}
          actionId={entry.rawStatus ?? null}
          calibrationNeeded={entry.rawStatus?.toLowerCase().includes("calibrat")}
          onRetry={() => {
            // Simple retry action: could be wired to actual API
            console.log("Retry calibration for", entry.deviceId);
          }}
        />
      </div>

      <div className="device-card__expand" aria-hidden={!open} style={{ maxHeight: open ? 240 : 0 }}>
        <div className="device-card__expanded-inner">
          <p style={{ margin: 0, color: "#475569" }}>Technical details:</p>
          <pre style={{ marginTop: 8, background: "#f1f5f9", padding: 10, borderRadius: 8, overflow: "auto" }}>{JSON.stringify(entry, null, 2)}</pre>
        </div>
      </div>
    </article>
  );
}
