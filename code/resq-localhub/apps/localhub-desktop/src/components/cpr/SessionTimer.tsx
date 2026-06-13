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
    <div className="flex flex-col items-center gap-1 py-1 select-none">
      <span className="text-xs font-extrabold text-slate-400 uppercase tracking-wider block">Elapsed Time</span>
      <span className="text-4xl font-mono font-extrabold text-slate-800 tabular-nums tracking-tight">
        {formatSeconds(elapsed)}
      </span>
    </div>
  );
}

export default SessionTimer;
