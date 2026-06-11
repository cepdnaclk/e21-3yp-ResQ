import React from "react";

export default function ProvisioningIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label="Provisioning helper"
      className="provisioning-icon"
    >
      <rect x="1" y="1" width="8" height="8" rx="1" stroke="var(--brand)" strokeWidth="1.4" />
      <rect x="3" y="3" width="4" height="4" fill="var(--brand)" />
      <rect x="12" y="1" width="6" height="6" rx="1" stroke="var(--brand)" strokeWidth="1.4" />
      <rect x="14" y="3" width="2" height="2" fill="var(--brand)" />

      <path d="M6 16c1-2 3-3 6-3s5 1 6 3" stroke="var(--brand)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 19c1-1.2 2.5-1.8 4-1.8s3 .6 4 1.8" stroke="var(--brand)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
