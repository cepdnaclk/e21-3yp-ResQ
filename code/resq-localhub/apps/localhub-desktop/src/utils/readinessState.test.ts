import { describe, expect, it } from "vitest";
import { deriveReadinessUiState } from "./readinessState";

describe("deriveReadinessUiState", () => {
  it("keeps calibration visible even when the live snapshot is temporarily stale", () => {
    expect(
      deriveReadinessUiState(
        {
          deviceId: "M01",
          sessionId: null,
          manikinId: null,
          online: false,
          lastSeen: null,
          state: "OFFLINE",
          ip: null,
          fw: null,
          rssi: null,
          battery: null,
          sessionActive: false,
          latestDepthMm: null,
          latestDepthProgress: null,
          latestCompressionCount: null,
          latestRateCpm: null,
          latestRecoilOk: null,
          latestPauseS: null,
          latestFlags: null,
          lastEventType: null,
          latestForce1: null,
          latestForce2: null,
          pressureBalancePct: null,
          pressureSkewed: null,
          activeSessionId: null,
          activeTraineeId: null,
          activeSessionStartedAt: null,
          activeSessionScenario: null,
          latestMetric: null,
          seq: null,
          connectionState: "STALE",
          stale: true,
          offline: true,
        } as any,
        {
          deviceId: "M01",
          calibrationState: "CALIBRATING",
          readyForSession: false,
          firmwareState: "CALIBRATING",
          ready: false,
        },
      ),
    ).toBe("CALIBRATING");
  });
});