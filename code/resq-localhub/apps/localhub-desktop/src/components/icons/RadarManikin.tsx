import React from "react";

export default function RadarManikin({ sweep = false, size = 20 }: { sweep?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id="rgrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(34,197,94,0.18)" />
          <stop offset="100%" stopColor="rgba(34,197,94,0)" />
        </radialGradient>
      </defs>
      <g transform="translate(4,4)">
        <circle cx="20" cy="20" r="18" stroke="#c7e7d0" strokeWidth="1.2" fill="transparent" />
        <g className={sweep ? 'radar-sweep' : ''}>
          <path d="M20 20 L38 2 A22 22 0 0 0 2 38 Z" fill="url(#rgrad)" opacity="0.9" />
        </g>
        <g transform="translate(10,8)">
          <rect x="4" y="10" width="12" height="14" rx="3" fill="#fff" stroke="#0f172a" strokeWidth="1" />
          <circle cx="10" cy="6" r="4" fill="#f8fafc" stroke="#0f172a" strokeWidth="1" />
        </g>
      </g>
    </svg>
  );
}
