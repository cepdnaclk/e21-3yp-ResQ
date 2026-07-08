import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./hubApiUrl", () => ({
  getHubApiBaseUrl: () => "http://localhost:18080",
}));

import { fetchManikinRegistry } from "./browserManikinRegistryApi";

describe("browserManikinRegistryApi", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the registry from the LocalHub backend and normalizes entries", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ([
        {
          deviceId: "M01",
          online: true,
          lastSeen: "2026-07-06T10:00:00.000Z",
          state: "READY_FOR_SESSION",
          ip: "192.168.1.44",
          fw: "1.2.3",
          rssi: -51,
          battery: 93,
          sessionActive: false,
          firmwareState: "READY",
          calibrated: true,
          readyForSession: true,
          calibrationState: "READY",
          progressId: 11,
          reasonId: "00000",
          actionId: 0,
          calibrationProgressId: 11,
          calibrationReasonId: "00000",
          calibrationActionId: 0,
          calibrationResult: "PASS",
          profileId: "adult-basic",
          pressureMode: "HALL_WITH_LAST_STABLE_PRESSURE",
          pressureDegraded: true,
          usingLastStablePressure: true,
          pressureValid: false,
          hallValid: true,
          depthSource: "HALL",
          warnings: "PRESSURE_SENSOR_SATURATED_USING_LAST_STABLE",
          lastErrorId: null,
        },
      ]),
    });
    vi.stubGlobal("fetch", fetchMock);

    const entries = await fetchManikinRegistry();

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:18080/api/manikins", {
      credentials: "include",
    });
    expect(entries).toEqual([
      {
        deviceId: "M01",
        online: true,
        lastSeen: "2026-07-06T10:00:00.000Z",
        state: "READY_FOR_SESSION",
        ip: "192.168.1.44",
        fw: "1.2.3",
        rssi: -51,
        battery: 93,
        sessionActive: false,
        firmwareState: "READY",
        calibrated: true,
        readyForSession: true,
        calibrationState: "READY",
        progressId: 11,
        reasonId: "00000",
        actionId: 0,
        calibrationProgressId: 11,
        calibrationReasonId: "00000",
        calibrationActionId: 0,
        calibrationResult: "PASS",
        profileId: "adult-basic",
        pressureMode: "HALL_WITH_LAST_STABLE_PRESSURE",
        pressureDegraded: true,
        usingLastStablePressure: true,
        pressureValid: false,
        hallValid: true,
        depthSource: "HALL",
        warnings: "PRESSURE_SENSOR_SATURATED_USING_LAST_STABLE",
        lastErrorId: null,
      },
    ]);
  });
});
