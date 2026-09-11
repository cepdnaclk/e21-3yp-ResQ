import { normalizeTelemetryPayload, toLiveClientUpdate } from "./liveClientTypes";

describe("SENSOR_STREAM session isolation", () => {
  it("does not normalize SENSOR_STREAM or unknown telemetry modes as CPR session telemetry", () => {
    const sensorStream = {
      device_id: "M01",
      telemetry_mode: "SENSOR_STREAM",
      state: "PAIRED_IDLE",
      pressure_0_kpa: 0.82,
      pressure_0_kpa_valid: true,
      pressure_1_kpa: 1.44,
      pressure_1_kpa_valid: true,
      pressure_2_kpa: 1.39,
      pressure_2_kpa_valid: true,
      pressure_kpa_valid: true,
      hall_mm: 24.5,
      hall_progress: 0.49,
      hall_mm_valid: true,
      pressure_saturation_mask: 0,
      interval_ms: 200,
      ts_ms: 124700,
      session_id: "session-1",
      compression_count: 99,
      depth_progress: 1,
    };

    expect(normalizeTelemetryPayload(sensorStream).ok).toBe(false);
    expect(toLiveClientUpdate(sensorStream)).toBeNull();
    expect(normalizeTelemetryPayload({ ...sensorStream, telemetry_mode: "MANUAL_DIAGNOSTIC" }).ok).toBe(false);
    expect(toLiveClientUpdate({ ...sensorStream, telemetry_mode: "MANUAL_DIAGNOSTIC" })).toBeNull();
  });
});
