export const LIVE_CHART_INTERVAL_MS = 100;
export const LIVE_CHART_WINDOW_MS = 60_000;
export const LIVE_CHART_MAX_SAMPLES = LIVE_CHART_WINDOW_MS / LIVE_CHART_INTERVAL_MS;

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
