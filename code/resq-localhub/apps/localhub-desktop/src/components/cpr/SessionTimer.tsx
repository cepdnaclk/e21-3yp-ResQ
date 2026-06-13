/**
 * SessionTimer.tsx — Live elapsed timer for an active session.
 */
import { useEffect, useState } from "react";

type SessionTimerProps = {
  startedAt: string | null | undefined;
  active?: boolean;
};

function getElapsedSeconds(startedAt: string | null | undefined): number {
  if (!startedAt) return 0;
  const start = new Date(startedAt).getTime();
  if (isNaN(start)) return 0;
  return Math.max(0, Math.floor((Date.now() - start) / 1000));
}

function formatSeconds(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function SessionTimer({ startedAt, active = true }: SessionTimerProps) {
  const [elapsed, setElapsed] = useState(() => getElapsedSeconds(startedAt));

  useEffect(() => {
    if (!active || !startedAt) return;
    const interval = setInterval(() => {
      setElapsed(getElapsedSeconds(startedAt));
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt, active]);

  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Duration</span>
      <span className="text-3xl font-mono font-bold text-gray-900 tabular-nums">
        {formatSeconds(elapsed)}
      </span>
    </div>
  );
}
