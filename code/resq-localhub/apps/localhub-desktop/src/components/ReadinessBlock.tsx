import React, { useEffect, useState } from "react";

type Props = {
  readyForSession: boolean;
  progressPercent: number; // 0-100
  progressId?: string | null;
  reasonId?: string | null;
  actionId?: string | null;
  calibrationNeeded?: boolean;
  onRetry?: () => void;
};

const STEPS = ["Calibrating", "Measuring", "Validating", "Ready"];

export default function ReadinessBlock({ readyForSession, progressPercent, progressId, reasonId, actionId, calibrationNeeded, onRetry }: Props) {
  const [glow, setGlow] = useState(false);
  const [retryBounce, setRetryBounce] = useState(false);

  useEffect(() => {
    if (readyForSession) {
      setGlow(true);
      const t = window.setTimeout(() => setGlow(false), 1200);
      return () => window.clearTimeout(t);
    }
  }, [readyForSession]);

  function handleRetry() {
    setRetryBounce(true);
    setTimeout(() => setRetryBounce(false), 600);
    onRetry?.();
  }

  // compute step index from percent
  const stepFloat = (progressPercent / 100) * (STEPS.length - 1);

  return (
    <div className={`readiness-block ${calibrationNeeded ? "readiness--dashed" : ""} ${glow ? "readiness--glow" : ""}`}>
      <div className="readiness-icon">
        {readyForSession ? (
          <svg className="icon-check" viewBox="0 0 24 24" width="56" height="56"><circle cx="12" cy="12" r="10" fill="#bbf7d0" /><path d="M7 13l3 3 7-7" stroke="#065f46" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>
        ) : (
          <svg className="icon-cross" viewBox="0 0 24 24" width="56" height="56"><circle cx="12" cy="12" r="10" fill="#fee2e2" /><path d="M8 8l8 8M16 8l-8 8" stroke="#7f1d1d" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>
        )}
      </div>

      <div className="readiness-body">
        <div className="readiness-timeline">
          {STEPS.map((s, i) => (
            <div key={s} className={`timeline-step ${i <= Math.round(stepFloat) ? "timeline-step--done" : ""}`}>
              <div className="timeline-dot" style={{ left: `${(i/(STEPS.length-1))*100}%` }} />
              <div className="timeline-label">{s}</div>
            </div>
          ))}
          <div className="timeline-roller" style={{ left: `${(stepFloat/(STEPS.length-1))*100}%` }} />
        </div>

        <div className="readiness-meta">
          <div className="readiness-ids" title="Hover to reveal raw IDs">
            <div className="rotating-cube" aria-hidden>
              <div className="cube-face">{progressId ?? "-"}</div>
              <div className="cube-face">{reasonId ?? "-"}</div>
              <div className="cube-face">{actionId ?? "-"}</div>
            </div>
          </div>

          <div>
            <button className={`button button--secondary ${retryBounce ? "retry-bounce" : ""}`} onClick={handleRetry}>Retry Calibration</button>
          </div>
        </div>
      </div>
    </div>
  );
}
