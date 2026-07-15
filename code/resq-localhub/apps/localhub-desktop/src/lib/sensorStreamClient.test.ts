import { startSensorStream, stopSensorStream, getLatestSensorStream } from "./sensorStreamClient";
import { parseSensorStreamSnapshot, validateSensorStreamInterval } from "./sensorStreamTypes";

vi.mock("./hubApiUrl", () => ({
  getHubApiBaseUrl: () => "http://hub.test",
}));

describe("sensorStreamClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts sensor stream with exact backend path and interval body only", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      device_id: "M01",
      request_id: "req-1",
      action: "START",
      command: "telemetry/start",
      topic: "resq/M01/cmd/telemetry",
      interval_ms: 200,
      status: "PUBLISHED",
    }));

    await startSensorStream("M01", 200);

    expect(fetch).toHaveBeenCalledWith("http://hub.test/api/devices/M01/telemetry/start", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interval_ms: 200 }),
    });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).not.toHaveProperty("session_id");
  });

  it("stops sensor stream without session body or session endpoint", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      device_id: "M01",
      request_id: "req-2",
      action: "STOP",
      command: "telemetry/stop",
      topic: "resq/M01/cmd/telemetry",
      status: "PUBLISHED",
    }));

    await stopSensorStream("M01");

    expect(fetch).toHaveBeenCalledWith("http://hub.test/api/devices/M01/telemetry/stop", {
      method: "POST",
      credentials: "include",
    });
    expect(String(vi.mocked(fetch).mock.calls[0][0])).not.toContain("/sessions/");
  });

  it("loads latest snapshot and treats missing snapshot as nonfatal", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      device_id: "M01",
      stream_observed: true,
      latest_snapshot: sampleSnapshot(),
      receivedAt: "2026-07-10T00:00:00Z",
    }));

    await expect(getLatestSensorStream("M01")).resolves.toMatchObject({
      deviceId: "M01",
      streamObserved: true,
      latestSnapshot: { pressure2KpaValid: false },
    });

    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: "missing" }), { status: 404 }));
    await expect(getLatestSensorStream("M01")).resolves.toBeNull();
  });

  it("validates interval boundaries and malformed snapshots", () => {
    expect(validateSensorStreamInterval("99")).toBe("Interval must be at least 100 ms.");
    expect(validateSensorStreamInterval("100")).toBeNull();
    expect(validateSensorStreamInterval("200")).toBeNull();
    expect(validateSensorStreamInterval("1000")).toBeNull();
    expect(validateSensorStreamInterval("1001")).toBe("Interval must not exceed 1000 ms.");
    expect(validateSensorStreamInterval("")).toBe("Interval is required.");
    expect(validateSensorStreamInterval("200.5")).toBe("Interval must be a whole number.");
    expect(validateSensorStreamInterval("-1")).toBe("Interval must be at least 100 ms.");

    expect(parseSensorStreamSnapshot({ ...sampleSnapshot(), device_id: "M02" }, "M01")).toBeNull();
    expect(parseSensorStreamSnapshot({ ...sampleSnapshot(), telemetry_mode: "SESSION" }, "M01")).toBeNull();
    expect(parseSensorStreamSnapshot({ ...sampleSnapshot(), pressure_0_kpa: Number.NaN }, "M01")).toBeNull();
    expect(parseSensorStreamSnapshot({ ...sampleSnapshot(), pressure_0_kpa_valid: "true" }, "M01")).toBeNull();
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

export function sampleSnapshot() {
  return {
    device_id: "M01",
    telemetry_mode: "SENSOR_STREAM",
    state: "PAIRED_IDLE",
    pressure_0_raw: 1244088,
    pressure_0_raw_valid: true,
    pressure_1_raw: 3279680,
    pressure_1_raw_valid: true,
    pressure_2_raw: -999999,
    pressure_2_raw_valid: false,
    hall_raw: 2783,
    hall_raw_valid: true,
    pressure_0_kpa: 0,
    pressure_0_kpa_valid: true,
    pressure_1_kpa: 1.4,
    pressure_1_kpa_valid: true,
    pressure_2_kpa: 0,
    pressure_2_kpa_valid: false,
    pressure_kpa_valid: false,
    hall_mm: 24.5,
    hall_progress: 0.49,
    hall_mm_valid: true,
    pressure_saturation_mask: 0,
    interval_ms: 200,
    ts_ms: 124700,
    receivedAt: "2026-07-10T00:00:00Z",
  };
}
