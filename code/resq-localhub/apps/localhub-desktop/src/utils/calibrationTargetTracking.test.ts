import { buildCalibrationTargets, estimateCalibrationDepthMm, isUsableRaw } from "./calibrationTargetTracking";

const config = {
  hall_delta: 1000,
  ref_pressure: 20000,
  bladder_1_pressure: 15000,
  bladder_2_pressure: 16000,
};

const sample = {
  pressure0Raw: 19000,
  pressure0RawValid: true,
  pressure1Raw: 14900,
  pressure1RawValid: true,
  pressure2Raw: -999999,
  pressure2RawValid: false,
  hallRaw: 2600,
  hallRawValid: true,
  hallMm: null,
  hallMmValid: false,
  receivedAt: "2026-07-15T00:00:00Z",
};

describe("calibrationTargetTracking", () => {
  it("renders configured targets and makes progress stage-aware", () => {
    const targets = buildCalibrationTargets({
      config,
      sample,
      progressId: 4,
      lastCompletedProgressId: 3,
      reasonId: null,
      hallBaselineRaw: null,
      fullDepthMm: 50,
    });

    expect(targets.map((target) => target.targetValue)).toEqual([20000, 15000, 16000, null, 1000]);
    expect(targets.find((target) => target.id === "reference")?.status).toBe("COMPLETED");
    expect(targets.find((target) => target.id === "bladder1")).toMatchObject({ active: true, status: "REACHED" });
    expect(targets.find((target) => target.id === "bladder2")?.status).toBe("PENDING");
  });

  it("uses raw validity and rejects the invalid sentinel", () => {
    expect(isUsableRaw(-999999, true)).toBe(false);
    const target = buildCalibrationTargets({
      config,
      sample: { ...sample, pressure0Raw: -999999, pressure0RawValid: true },
      progressId: 2,
      lastCompletedProgressId: 0,
      reasonId: null,
      hallBaselineRaw: null,
      fullDepthMm: null,
    })[0];
    expect(target).toMatchObject({ currentValue: null, rawValid: false, status: "INVALID" });
  });

  it("uses the absolute Hall delta and estimates temporary depth safely", () => {
    const full = buildCalibrationTargets({
      config,
      sample,
      progressId: 9,
      lastCompletedProgressId: 8,
      reasonId: null,
      hallBaselineRaw: 3000,
      fullDepthMm: 50,
    }).find((target) => target.id === "full");
    expect(full).toMatchObject({ currentHallDelta: 400, currentDepthMm: 20, depthEstimated: true });
    expect(estimateCalibrationDepthMm(400, 0, 50)).toBeNull();
    expect(estimateCalibrationDepthMm(400, 1000, 0)).toBeNull();
    expect(estimateCalibrationDepthMm(Number.POSITIVE_INFINITY, 1000, 50)).toBeNull();
  });

  it("marks the reason 08405 stage failed with exact guidance", () => {
    const full = buildCalibrationTargets({
      config,
      sample,
      progressId: 12,
      lastCompletedProgressId: 8,
      reasonId: "08405",
      hallBaselineRaw: 3000,
      fullDepthMm: 50,
    }).find((target) => target.id === "full");
    expect(full).toMatchObject({ status: "FAILED", guidance: "Full compression target was not reached.", currentHallDelta: 400, targetHallDelta: 1000 });
  });

  it("labels Hall baseline as captured during calibration instead of inventing a target", () => {
    const baseline = buildCalibrationTargets({
      config,
      sample,
      progressId: 7,
      lastCompletedProgressId: 7,
      reasonId: null,
      hallBaselineRaw: null,
      fullDepthMm: null,
    }).find((target) => target.id === "baseline");
    expect(baseline).toMatchObject({ targetValue: null, targetLabel: "Captured during calibration", active: true });
  });
});
