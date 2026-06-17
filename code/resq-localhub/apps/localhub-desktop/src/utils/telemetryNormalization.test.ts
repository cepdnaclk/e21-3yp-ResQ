import { describe, expect, it } from "vitest";
import { normalizeTelemetry } from "./telemetryNormalization";
import type { SessionLiveView } from "../types/live";

describe("telemetryNormalization", () => {
  it("normalizes depth_progress 0.72 to depthMm 36 if depthMm is missing", () => {
    const session: Partial<SessionLiveView> = {
      sessionId: "s1",
      deviceId: "d1",
      latestDepthMm: null,
      latestMetric: {
        deviceId: "d1",
        sessionId: "s1",
        depthMm: null,
        depthProgress: 0.72,
        rateCpm: 110,
        recoilOk: true,
        pauseS: 0,
        compressionCount: 10,
        handPlacement: "CENTER",
        flags: null,
      },
    };

    const res = normalizeTelemetry(session as SessionLiveView);
    expect(res.depthMm).toBe(36);
    expect(res.depthPercent).toBe(72);
    expect(res.isDerivedDepth).toBe(true);
  });

  it("normalizes rate_cpm mapping to rateCpm", () => {
    const session: Partial<SessionLiveView> = {
      sessionId: "s1",
      deviceId: "d1",
      latestRateCpm: null,
      latestMetric: {
        deviceId: "d1",
        sessionId: "s1",
        depthMm: 50,
        rateCpm: 115,
        recoilOk: true,
        pauseS: 0,
        compressionCount: 10,
        handPlacement: "CENTER",
        flags: null,
      },
    };

    const res = normalizeTelemetry(session as SessionLiveView);
    expect(res.rateCpm).toBe(115);
  });

  it("normalizes recoil_ok_count 8 and incomplete_recoil_count 2 to recoilPct 80", () => {
    const session: Partial<SessionLiveView> = {
      sessionId: "s1",
      deviceId: "d1",
      latestMetric: {
        deviceId: "d1",
        sessionId: "s1",
        depthMm: 50,
        rateCpm: 110,
        recoilOk: true,
        recoilOkCount: 8,
        incompleteRecoilCount: 2,
        pauseS: 0,
        compressionCount: 10,
        handPlacement: "CENTER",
        flags: null,
      },
    };

    const res = normalizeTelemetry(session as SessionLiveView);
    expect(res.recoilPct).toBe(80);
    expect(res.hasRecoilCounts).toBe(true);
    expect(res.recoilTotal).toBe(10);
  });

  it("detects when recoil total is 0", () => {
    const session: Partial<SessionLiveView> = {
      sessionId: "s1",
      deviceId: "d1",
      latestMetric: {
        deviceId: "d1",
        sessionId: "s1",
        depthMm: 50,
        rateCpm: 110,
        recoilOk: true,
        recoilOkCount: 0,
        incompleteRecoilCount: 0,
        pauseS: 0,
        compressionCount: 0,
        handPlacement: "CENTER",
        flags: null,
      },
    };

    const res = normalizeTelemetry(session as SessionLiveView);
    expect(res.recoilPct).toBeNull();
    expect(res.hasRecoilCounts).toBe(true);
    expect(res.recoilTotal).toBe(0);
  });

  it("handles missing latestMetric without crashing", () => {
    const session: Partial<SessionLiveView> = {
      sessionId: "s1",
      deviceId: "d1",
      latestDepthMm: 48,
      latestRateCpm: 105,
      latestRecoilOk: true,
      latestMetric: null,
    };

    const res = normalizeTelemetry(session as SessionLiveView);
    expect(res.depthMm).toBe(48);
    expect(res.rateCpm).toBe(105);
    expect(res.recoilPct).toBe(100);
    expect(res.isDerivedDepth).toBe(false);
  });

  it("supports snake_case firmware/MQTT fields", () => {
    const session: Partial<SessionLiveView> = {
      sessionId: "s1",
      deviceId: "d1",
      latestMetric: {
        deviceId: "d1",
        sessionId: "s1",
        depth_progress: 0.8,
        rate_cpm: 108,
        recoil_ok_count: 9,
        incomplete_recoil_count: 1,
        pause_s: 1.5,
        quality_flags: "DEPTH_OK,RATE_OK",
        hand_placement: "LEFT",
        pressure_balance_pct: 51,
      } as any,
    };

    const res = normalizeTelemetry(session as SessionLiveView);
    expect(res.depthMm).toBe(40);
    expect(res.depthPercent).toBe(80);
    expect(res.rateCpm).toBe(108);
    expect(res.recoilPct).toBe(90);
    expect(res.pauseS).toBe(1.5);
    expect(res.flags).toBe("DEPTH_OK,RATE_OK");
    expect(res.isDerivedDepth).toBe(true);
    expect(res.handPlacement).toBe("LEFT");
    expect(res.pressureBalancePct).toBe(51);
  });
});
