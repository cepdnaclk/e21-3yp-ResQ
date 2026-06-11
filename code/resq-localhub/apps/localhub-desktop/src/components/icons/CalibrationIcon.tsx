import React from "react";

export default function CalibrationIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="3" stroke="var(--brand)" strokeWidth="1.4" />
      <rect x="13" y="4" width="8" height="6" rx="1" stroke="var(--brand)" strokeWidth="1.4" />
      <path d="M7 11v6" stroke="var(--brand)" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
