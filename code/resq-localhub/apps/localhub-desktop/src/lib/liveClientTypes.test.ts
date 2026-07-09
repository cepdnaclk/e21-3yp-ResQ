import { describe, expect, it } from "vitest";
import { isLiveUpdateForSelection, normalizeTelemetryPayload, toLiveMetric } from "./liveClientTypes";

describe("live telemetry normalization", () => {
  it("normalizes metric-first telemetry into the shared live metric shape", () => {
    const result = normalizeTelemetryPayload({
      deviceId: "M01",
      manikinId: "MK-01",
      sessionId: "S-TEST-001",
      seq: 1,
      tsMs: 12345678,
      depthMm: 52,
      rateCpm: 110,
      recoilOk: true,
      pauseS: 0.2,
      compressionCount: 18,
      handPlacement: "CENTER",
      flags: ["DEPTH_OK", "RATE_OK", "RECOIL_OK"],
      sourceMode: "simulator",
      debugRaw: { hallRaw: 3420 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.reason);
    }
    expect(result.value).toMatchObject({
      deviceId: "M01",
      manikinId: "MK-01",
      sessionId: "S-TEST-001",
      seq: 1,
      depthMm: 52,
      rateCpm: 110,
      recoilOk: true,
      pauseS: 0.2,
      compressionCount: 18,
      handPlacement: "CENTER",
      flags: ["DEPTH_OK", "RATE_OK", "RECOIL_OK"],
      sourceMode: "simulator",
      debugRaw: { hallRaw: 3420 },
    });
  });

  it("converts safe legacy simulator fields without requiring raw values in the UI", () => {
    const metric = toLiveMetric({
      device_id: "M01",
      session_id: "S-TEST-001",
      force1: 120000,
      force2: 118000,
      hall_raw: 3420,
      current_delta: 52,
      total_compressions: 18,
      feedback: "PERFECT",
    });

    expect(metric).toMatchObject({
      deviceId: "M01",
      sessionId: "S-TEST-001",
      depthMm: 52,
      compressionCount: 18,
      flags: "DEPTH_OK,RATE_OK,RECOIL_OK",
      sourceMode: "simulator",
    });
    expect(metric).not.toHaveProperty("force1");
    expect(metric).not.toHaveProperty("force2");
    expect(metric).not.toHaveProperty("hall_raw");
  });

  it("rejects incomplete telemetry without crashing", () => {
    const result = normalizeTelemetryPayload({
      deviceId: "M01",
      sessionId: "S-TEST-001",
      compressionCount: 18,
      handPlacement: "CENTER",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected incomplete telemetry to be rejected");
    }
    expect(result.reason).toContain("required metric-first fields");
    expect(toLiveMetric({ deviceId: "M01", sessionId: "S-TEST-001" })).toBeNull();
  });

  it("maps Hall depth source from pressure-degraded firmware telemetry", () => {
    const metric = toLiveMetric({
      device_id: "M01",
      session_id: "S-HALL-1",
      depth_progress: 0.64,
      depth_source: "HALL",
      rate_cpm: 109,
      pressure_valid: false,
      pressure_degraded: true,
    });

    expect(metric).toMatchObject({
      deviceId: "M01",
      sessionId: "S-HALL-1",
      depthProgress: 0.64,
      sourceMode: "hall",
    });
  });

  it("keeps strict selected device and session filtering", () => {
    expect(isLiveUpdateForSelection({ deviceId: "M01", sessionId: "S-1" }, "M01", "S-1")).toBe(true);
    expect(isLiveUpdateForSelection({ deviceId: "M02", sessionId: "S-1" }, "M01", "S-1")).toBe(false);
    expect(isLiveUpdateForSelection({ deviceId: "M01", sessionId: "S-2" }, "M01", "S-1")).toBe(false);
    expect(isLiveUpdateForSelection({ deviceId: "M01", sessionId: null }, "M01", "S-1")).toBe(false);
  });
});
