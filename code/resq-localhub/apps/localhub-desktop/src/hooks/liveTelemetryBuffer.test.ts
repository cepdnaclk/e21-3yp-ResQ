import { describe, expect, it } from "vitest";
import {
  LIVE_CHART_MAX_SAMPLES,
  decimateTelemetry,
  LiveTelemetryRingBuffer,
} from "./liveTelemetryBuffer";

describe("LiveTelemetryRingBuffer", () => {
  it("keeps a fixed-size newest-sample window", () => {
    const buffer = new LiveTelemetryRingBuffer<{ timestampMs: number; value: number }>(3);

    buffer.push({ timestampMs: 1, value: 1 });
    buffer.push({ timestampMs: 2, value: 2 });
    buffer.push({ timestampMs: 3, value: 3 });
    buffer.push({ timestampMs: 4, value: 4 });

    expect(buffer.size).toBe(3);
    expect(buffer.toArray().map((sample) => sample.value)).toEqual([2, 3, 4]);
  });

  it("prunes samples outside the time window and resets deterministically", () => {
    const buffer = new LiveTelemetryRingBuffer<{ timestampMs: number }>(4);
    buffer.push({ timestampMs: 1_000 });
    buffer.push({ timestampMs: 2_000 });
    buffer.push({ timestampMs: 3_000 });

    buffer.pruneBefore(2_000);
    expect(buffer.toArray()).toEqual([{ timestampMs: 2_000 }, { timestampMs: 3_000 }]);

    buffer.clear();
    expect(buffer.size).toBe(0);
    expect(buffer.toArray()).toEqual([]);
  });

  it("bounds one minute of chart data at the configured cadence", () => {
    expect(LIVE_CHART_MAX_SAMPLES).toBe(1200);
  });

  it("decimates visible data while preserving first/last bucket extrema", () => {
    const samples = Array.from({ length: 1_000 }, (_, timestampMs) => ({
      timestampMs,
      depthMm: timestampMs % 11,
    }));
    const visible = decimateTelemetry(samples, 200);
    expect(visible.length).toBeLessThanOrEqual(200);
    expect(Math.max(...visible.map((sample) => sample.depthMm))).toBe(10);
  });
});
