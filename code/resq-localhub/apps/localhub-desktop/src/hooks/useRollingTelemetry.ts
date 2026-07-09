import { useEffect, useState, useRef } from "react";
import type { SessionLiveView } from "../types/live";
import { normalizeTelemetry } from "../utils/telemetryNormalization";

export interface RollingSample {
  time: string;
  depthMm: number | null;
  rateCpm: number | null;
  recoilPct: number | null;
}

export function useRollingTelemetry(session: SessionLiveView | null) {
  const [data, setData] = useState<RollingSample[]>([]);
  const lastSeqRef = useRef<number | null>(null);
  const sessionId = session?.sessionId ?? null;

  useEffect(() => {
    setData([]);
    lastSeqRef.current = null;
  }, [sessionId]);

  useEffect(() => {
    if (!session?.active) {
      return;
    }

    const metric = session.latestMetric as any;
    if (!metric) return;

    // Use normalized values
    const normalized = normalizeTelemetry(session);

    // Avoid duplicates using seq or tsMs
    const seq = metric.seq ?? metric.tsMs ?? metric.ts_ms ?? Date.now();
    if (lastSeqRef.current !== null && seq <= lastSeqRef.current) {
      return;
    }
    lastSeqRef.current = seq;

    // Time label formatting
    const ts = metric.tsMs ?? metric.ts_ms;
    const timeLabel = ts
      ? new Date(ts).toLocaleTimeString([], { hour12: false, minute: "2-digit", second: "2-digit" })
      : new Date().toLocaleTimeString([], { hour12: false, minute: "2-digit", second: "2-digit" });

    setData((prev) => {
      const next = [
        ...prev,
        {
          time: timeLabel,
          depthMm: normalized.depthMm !== null ? Number(normalized.depthMm.toFixed(1)) : null,
          rateCpm: normalized.rateCpm !== null ? Number(normalized.rateCpm.toFixed(1)) : null,
          recoilPct: normalized.recoilPct !== null ? Number(normalized.recoilPct.toFixed(0)) : null,
        },
      ];
      return next.slice(-60); // Keep last 60 samples
    });
  }, [session?.latestMetric?.seq, session?.latestMetric?.tsMs, (session?.latestMetric as any)?.ts_ms, session?.active, session]);

  return data;
}
