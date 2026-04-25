export default function ResQLogo() {
  return (
    <div className="flex flex-col items-center gap-2 mb-6 md:mb-8">
      {/* Heart: left half navy + ECG, right half medium blue + medical cross */}
      <svg
        width="72"
        height="64"
        viewBox="0 0 72 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
        className="shrink-0"
      >
        {/* Left half of heart - dark navy with ECG waveform */}
        <path
          d="M36 8 C18 0 0 16 0 30 C0 44 36 62 36 62 L36 8 Z"
          fill="#0f172a"
        />
        {/* ECG heartbeat line on left half (M/W shape) */}
        <path
          d="M10 32 L18 32 L22 42 L26 26 L30 32 L34 32"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          opacity={0.9}
        />
        {/* Right half of heart - medium blue */}
        <path
          d="M36 8 C54 0 72 16 72 30 C72 44 36 62 36 62 L36 8 Z"
          fill="#2563eb"
        />
        {/* Medical cross on right half, extending beyond heart */}
        <rect x="48" y="22" width="5" height="22" rx="1" fill="white" />
        <rect x="42" y="28" width="17" height="5" rx="1" fill="white" />
      </svg>
      {/* Company name: serif, mixed case ResQ, dark navy */}
      <h1
        className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-[#0f172a]"
        style={{ fontFamily: '"Libre Baskerville", Georgia, serif' }}
      >
        ResQ
      </h1>
      {/* Tagline: italic serif, muted blue */}
      <p
        className="text-sm md:text-base italic text-[#475569]"
        style={{ fontFamily: '"Libre Baskerville", Georgia, serif' }}
      >
        Training Hands, Saving Lives.
      </p>
    </div>
  )
}
