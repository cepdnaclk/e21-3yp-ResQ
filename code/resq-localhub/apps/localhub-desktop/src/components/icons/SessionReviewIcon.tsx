import React from "react";

export default function SessionReviewIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="6" height="6" rx="1" stroke="var(--brand)" strokeWidth="1.4" />
      <path d="M14 7h6M14 11h6M14 15h6" stroke="var(--brand)" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
