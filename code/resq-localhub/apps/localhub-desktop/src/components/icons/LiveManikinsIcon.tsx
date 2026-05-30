import React from "react";

export default function LiveManikinsIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 12c4-6 14-6 18 0" stroke="var(--brand)" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="6" cy="12" r="2" fill="var(--brand)" />
      <circle cx="12" cy="12" r="2" fill="var(--brand)" />
      <circle cx="18" cy="12" r="2" fill="var(--brand)" />
    </svg>
  );
}
