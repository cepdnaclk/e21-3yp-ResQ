import { render, screen, within, act, fireEvent } from "@testing-library/react";
import { FirmwareDiagnosticsPanel } from "./FirmwareDiagnosticsPanel";
import type { SensorStreamClientCallbacks } from "../lib/sensorStreamClient";

vi.mock("../lib/browserFirmwareApi", () => ({
  getFirmwareDiagnostics: vi.fn(async () => ({
    deviceId: "M01",
    readiness: null,
    latestCalibration: null,
    liveSummary: null,
    recentCommands: [],
    recentEvents: [],
    recentDebugSnapshots: [],
  })),
  requestFirmwareDebugSnapshot: vi.fn(),
}));

const startSensorStreamMock = vi.fn();
const stopSensorStreamMock = vi.fn();
const getLatestSensorStreamMock = vi.fn();
let callbacks: SensorStreamClientCallbacks | null = null;
const stopClientMock = vi.fn();

vi.mock("../lib/sensorStreamClient", () => ({
  startSensorStream: (...args: unknown[]) => startSensorStreamMock(...args),
  stopSensorStream: (...args: unknown[]) => stopSensorStreamMock(...args),
  getLatestSensorStream: (...args: unknown[]) => getLatestSensorStreamMock(...args),
  createSensorStreamClient: (_deviceId: string, cb: SensorStreamClientCallbacks) => {
    callbacks = cb;
    return { start: vi.fn(), stop: stopClientMock };
  },
}));

describe("FirmwareDiagnosticsPanel sensor stream", () => {
  beforeEach(() => {
    callbacks = null;
    stopClientMock.mockClear();
    startSensorStreamMock.mockResolvedValue({
      deviceId: "M01",
      requestId: "req-start",
      action: "START",
      command: "telemetry/start",
      topic: "resq/M01/cmd/telemetry",
      intervalMs: 200,
      status: "PUBLISHED",
    });
    stopSensorStreamMock.mockResolvedValue({
      deviceId: "M01",
      requestId: "req-stop",
      action: "STOP",
      command: "telemetry/stop",
      topic: "resq/M01/cmd/telemetry",
      status: "PUBLISHED",
    });
    getLatestSensorStreamMock.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("validates intervals and does not claim running after HTTP publish", async () => {
    render(<FirmwareDiagnosticsPanel deviceId="M01" />);

    const input = screen.getByLabelText("Interval (ms)");
    fireEvent.change(input, { target: { value: "99" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Interval must be at least 100 ms.");
    expect(screen.getByRole("button", { name: "Start Stream" })).toBeDisabled();

    fireEvent.change(input, { target: { value: "200" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start Stream" }));
    });

    expect(startSensorStreamMock).toHaveBeenCalledWith("M01", 200);
    expect(screen.getByText("START command published")).toBeInTheDocument();
    expect(screen.getByText("Waiting for first packet")).toBeInTheDocument();
    expect(screen.queryByText("Running")).not.toBeInTheDocument();
  });

  it("renders first packet, partial pressure validity, saturation and hall validity", async () => {
    render(<FirmwareDiagnosticsPanel deviceId="M01" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start Stream" }));
    });

    act(() => callbacks?.onSnapshot({
      ...snapshot(),
      pressure0Kpa: 0,
      pressure0KpaValid: true,
      pressure1Kpa: 1.44,
      pressure1KpaValid: true,
      pressure2Kpa: 0,
      pressure2KpaValid: false,
      pressureKpaValid: false,
      pressureSaturationMask: 0,
    }));

    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Pressure 0" })).getByText("0.0 kPa")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Pressure 1" })).getByText("1.4 kPa")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Pressure 2" })).getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getAllByText("Pressure data degraded")).toHaveLength(3);

    act(() => callbacks?.onSnapshot({ ...snapshot(), pressureSaturationMask: 4, pressure2KpaValid: true }));
    expect(within(screen.getByRole("group", { name: "Pressure 2" })).getByText("Saturated")).toBeInTheDocument();

    expect(within(screen.getByRole("group", { name: "Hall" })).getByText("24.5 mm")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Hall" })).getByText("Progress: 49%")).toBeInTheDocument();

    act(() => callbacks?.onSnapshot({ ...snapshot(), hallMm: 0, hallProgress: 0, hallMmValid: false }));
    expect(within(screen.getByRole("group", { name: "Hall" })).getByText("Unavailable")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Hall" })).getByText("Progress: Unavailable")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Hall" })).queryByText("0.0 mm")).not.toBeInTheDocument();
  });

  it("stales, reconnects, stops without session endpoint, and cleans up old device client", async () => {
    vi.useFakeTimers();
    const { rerender, unmount } = render(<FirmwareDiagnosticsPanel deviceId="M01" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start Stream" }));
    });
    await act(async () => {
      callbacks?.onSnapshot(snapshot());
    });

    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByText("Stale")).toBeInTheDocument();

    act(() => callbacks?.onError(new Error("network")));
    expect(screen.getByText("Reconnecting")).toBeInTheDocument();
    act(() => callbacks?.onSnapshot(snapshot()));
    expect(screen.getByText("Running")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop Stream" }));
    });
    expect(stopSensorStreamMock).toHaveBeenCalledWith("M01");
    expect(String(stopSensorStreamMock.mock.calls[0][0])).not.toContain("session");
    expect(screen.getByText("Stopping")).toBeInTheDocument();

    rerender(<FirmwareDiagnosticsPanel deviceId="M02" />);
    expect(stopClientMock).toHaveBeenCalled();
    act(() => callbacks?.onSnapshot({ ...snapshot(), deviceId: "M01" }));
    expect(screen.queryByText("PAIRED_IDLE")).not.toBeInTheDocument();

    unmount();
    expect(stopClientMock).toHaveBeenCalledTimes(2);
  });

  it("renders latest snapshot before first SSE packet and treats missing latest as nonfatal", async () => {
    getLatestSensorStreamMock.mockResolvedValueOnce({ latestSnapshot: snapshot() });
    const first = render(<FirmwareDiagnosticsPanel deviceId="M01" />);
    expect(await screen.findByText("24.5 mm")).toBeInTheDocument();
    first.unmount();

    getLatestSensorStreamMock.mockResolvedValueOnce(null);
    render(<FirmwareDiagnosticsPanel deviceId="M02" />);
    expect(await screen.findAllByText("No recent command requests or firmware events.")).toHaveLength(1);
  });
});

function snapshot() {
  return {
    deviceId: "M01",
    telemetryMode: "SENSOR_STREAM" as const,
    state: "PAIRED_IDLE",
    pressure0Kpa: 0.82,
    pressure0KpaValid: true,
    pressure1Kpa: 1.44,
    pressure1KpaValid: true,
    pressure2Kpa: 1.39,
    pressure2KpaValid: true,
    pressureKpaValid: true,
    hallMm: 24.5,
    hallProgress: 0.49,
    hallMmValid: true,
    pressureSaturationMask: 0,
    intervalMs: 200,
    firmwareTimestampMs: 124700,
    receivedAt: "2026-07-10T00:00:00Z",
  };
}
