export const LIVE_CHART_INTERVAL_MS = 50;
export const LIVE_CHART_WINDOW_MS = 60_000;
export const LIVE_CHART_MAX_SAMPLES = LIVE_CHART_WINDOW_MS / LIVE_CHART_INTERVAL_MS;
export const LIVE_CHART_MAX_VISIBLE_POINTS = 360;

export type TimestampedSample = {
  timestampMs: number;
};

/**
 * Fixed-capacity ring buffer used by the live chart. Writes never grow the
 * backing array and snapshots are only allocated at the chart render cadence.
 */
export class LiveTelemetryRingBuffer<T extends TimestampedSample> {
  private readonly values: Array<T | undefined>;
  private start = 0;
  private length = 0;

  constructor(private readonly capacity = LIVE_CHART_MAX_SAMPLES) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error("Live telemetry buffer capacity must be a positive integer.");
    }
    this.values = new Array<T | undefined>(capacity);
  }

  get size() {
    return this.length;
  }

  clear() {
    this.values.fill(undefined);
    this.start = 0;
    this.length = 0;
  }

  push(value: T) {
    if (this.length < this.capacity) {
      this.values[(this.start + this.length) % this.capacity] = value;
      this.length += 1;
      return;
    }

    this.values[this.start] = value;
    this.start = (this.start + 1) % this.capacity;
  }

  pruneBefore(timestampMs: number) {
    while (this.length > 0) {
      const oldest = this.values[this.start];
      if (!oldest || oldest.timestampMs >= timestampMs) {
        break;
      }
      this.values[this.start] = undefined;
      this.start = (this.start + 1) % this.capacity;
      this.length -= 1;
    }
  }

  toArray(): T[] {
    const snapshot = new Array<T>(this.length);
    for (let index = 0; index < this.length; index += 1) {
      snapshot[index] = this.values[(this.start + index) % this.capacity] as T;
    }
    return snapshot;
  }
}

/**
 * Shape-preserving min/max decimation. Each horizontal bucket contributes at
 * most two points, so the waveform remains bounded by the visible resolution.
 */
export function decimateTelemetry<T extends TimestampedSample & { depthMm: number | null }>(
  samples: readonly T[],
  maxPoints = LIVE_CHART_MAX_VISIBLE_POINTS,
): T[] {
  if (samples.length <= maxPoints) return samples.slice();
  const bucketCount = Math.max(1, Math.floor(maxPoints / 2));
  const bucketSize = samples.length / bucketCount;
  const result: T[] = [];
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = Math.floor(bucket * bucketSize);
    const end = Math.min(samples.length, Math.floor((bucket + 1) * bucketSize));
    let minimum = samples[start];
    let maximum = samples[start];
    for (let index = start + 1; index < end; index += 1) {
      const sample = samples[index];
      if ((sample.depthMm ?? Infinity) < (minimum.depthMm ?? Infinity)) minimum = sample;
      if ((sample.depthMm ?? -Infinity) > (maximum.depthMm ?? -Infinity)) maximum = sample;
    }
    if (minimum.timestampMs <= maximum.timestampMs) result.push(minimum, maximum);
    else result.push(maximum, minimum);
  }
  return result.slice(0, maxPoints);
}
