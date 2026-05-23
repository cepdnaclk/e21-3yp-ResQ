import React from "react";

export default function PlusPulse({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="plus-pulse-root">
      <circle cx="12" cy="12" r="11" fill="transparent" stroke="#e6f7ec" strokeWidth="2" className="plus-pulse-ring" />
      <path d="M12 7v10M7 12h10" stroke="#0f172a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
