import React from "react";

export default function HubHeartbeat({ state = "checking", size = 20 }: { state?: 'ok'|'down'|'checking', size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="0" y="0" width="24" height="24" rx="4" fill="transparent" />
      <path d="M2 13h4l1-3 2 6 3-12 2 8 3-4 2 5h3" stroke={state === 'ok' ? '#16a34a' : state === 'down' ? '#dc2626' : '#94a3b8'} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="hb-stroke" />
    </svg>
  );
}
