import { useEffect, useRef, useState } from "react";
import type { LiveMetricPayload } from "../types/live";
import type { NormalizedTelemetry } from "../utils/telemetryNormalization";
import {
  LIVE_CHART_INTERVAL_MS,
  LIVE_CHART_WINDOW_MS,
  LiveTelemetryRingBuffer,
} from "./liveTelemetryBuffer";

export interface RollingSample {
  timestampMs: number;
  time: string;
  depthMm: number | null;
  rateCpm: number | null;
  recoilPct: number | null;
}

type RollingTelemetryInput = {
  sessionId: string | null;
  active: boolean;
  metric: LiveMetricPayload | null;
  normalized: NormalizedTelemetry;
};

export function useRollingTelemetry({
  sessionId,
  active,
  metric,
  normalized,
}: RollingTelemetryInput) {
  const [data, setData] = useState<RollingSample[]>([]);
  const lastSeqRef = useRef<number | null>(null);
  const lastPublishedAtRef = useRef(0);
  const pendingRef = useRef<RollingSample | null>(null);
  const timerRef = useRef<number | null>(null);
  const bufferRef = useRef(new LiveTelemetryRingBuffer<RollingSample>());

  useEffect(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    bufferRef.current.clear();
    pendingRef.current = null;
    setData([]);
    lastSeqRef.current = null;
    lastPublishedAtRef.current = 0;

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, [sessionId]);

  useEffect(() => {
    if (!active || !metric) {
      return;
    }

    // Avoid duplicates using seq or tsMs
    const legacyMetric = metric as LiveMetricPayload & { ts_ms?: number };
    const sampleTimestamp = metric.tsMs ?? legacyMetric.ts_ms ?? Date.now();
    const seq = metric.seq ?? sampleTimestamp;
    if (lastSeqRef.current !== null && seq <= lastSeqRef.current) {
      return;
    }
    lastSeqRef.current = seq;

    pendingRef.current = {
      timestampMs: sampleTimestamp,
      time: new Date(sampleTimestamp).toLocaleTimeString([], {
        hour12: false,
        minute: "2-digit",
        second: "2-digit",
      }),
      depthMm:
        normalized.instantaneousDepthMm !== null
          ? Number(normalized.instantaneousDepthMm.toFixed(1))
          : null,
      rateCpm:
        normalized.rateCpm !== null ? Number(normalized.rateCpm.toFixed(1)) : null,
      recoilPct:
        normalized.recoilPct !== null ? Number(normalized.recoilPct.toFixed(0)) : null,
    };

    const publish = () => {
      timerRef.current = null;
      const pending = pendingRef.current;
      if (!pending) {
        return;
      }
      pendingRef.current = null;
      bufferRef.current.push(pending);
      bufferRef.current.pruneBefore(pending.timestampMs - LIVE_CHART_WINDOW_MS);
      lastPublishedAtRef.current = performance.now();
      setData(bufferRef.current.toArray());
    };

    const elapsed = performance.now() - lastPublishedAtRef.current;
    if (lastPublishedAtRef.current === 0 || elapsed >= LIVE_CHART_INTERVAL_MS) {
      publish();
    } else if (timerRef.current === null) {
      timerRef.current = window.setTimeout(
        publish,
        LIVE_CHART_INTERVAL_MS - elapsed,
      );
    }
  }, [
    active,
    metric,
    normalized.instantaneousDepthMm,
    normalized.rateCpm,
    normalized.recoilPct,
  ]);

  return data;
}
