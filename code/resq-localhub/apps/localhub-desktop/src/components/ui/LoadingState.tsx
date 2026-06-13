type LoadingStateProps = {
  message?: string;
};

export function LoadingState({ message = "Loading…" }: LoadingStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 select-none">
      <div className="relative flex items-center justify-center">
        {/* Ring animations */}
        <span className="animate-ping absolute inline-flex h-8 w-8 rounded-full bg-blue-400 opacity-20" />
        <svg
          className="animate-spin w-8 h-8 text-blue-600 relative z-10"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path
            className="opacity-80"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      </div>
      <p className="text-sm font-semibold text-slate-500 tracking-wide mt-2">{message}</p>
    </div>
  );
}

export default LoadingState;
