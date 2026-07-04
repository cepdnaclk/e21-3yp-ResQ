import React from "react";

export default function DeviceRegistryIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="6" height="6" rx="1" stroke="var(--brand)" strokeWidth="1.4" />
      <rect x="15" y="4" width="6" height="6" rx="1" stroke="var(--brand)" strokeWidth="1.4" />
      <rect x="3" y="14" width="6" height="6" rx="1" stroke="var(--brand)" strokeWidth="1.4" />
      <rect x="15" y="14" width="6" height="6" rx="1" stroke="var(--brand)" strokeWidth="1.4" />
    </svg>
  );
}
