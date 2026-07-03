import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import CalibrationWizardPage from "./CalibrationWizardPage";
import { getDeviceReadiness, startCalibration, cancelCalibration } from "../../api/manikinsApi";
import { connectCalibrationStream } from "../../api/liveEventsClient";

vi.mock("../../api/manikinsApi", () => ({
  getDeviceReadiness: vi.fn(),
  startCalibration: vi.fn(),
  cancelCalibration: vi.fn(),
}));

vi.mock("../../api/liveEventsClient", () => ({
  connectCalibrationStream: vi.fn(),
}));

describe("CalibrationWizardPage", () => {
  let sseHandlers: any = null;
  const mockClose = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    sseHandlers = null;
    mockClose.mockClear();

    vi.mocked(getDeviceReadiness).mockResolvedValue({
      deviceId: "MAN-01",
      calibrationState: "NOT_READY",
      readyForSession: false,
    });

    vi.mocked(connectCalibrationStream).mockImplementation((deviceId, handlers) => {
      sseHandlers = handlers;
      return {
        close: mockClose,
      } as any;
    });
  });

  it("renders the default form and options", async () => {
    render(<CalibrationWizardPage deviceId="MAN-01" onBack={vi.fn()} />);

    expect(await screen.findByText("Calibration / Pre-Check")).toBeInTheDocument();
    expect(screen.getByText("MAN-01")).toBeInTheDocument();

    // Verify default form fields are loaded
    expect(screen.getByLabelText(/Hall Delta/i)).toHaveValue("13500");
    expect(screen.getByLabelText(/Reference Pressure/i)).toHaveValue("20100");
    expect(screen.getByLabelText(/Bladder 1 Pressure/i)).toHaveValue("15000");
    expect(screen.getByLabelText(/Bladder 2 Pressure/i)).toHaveValue("15000");
    expect(screen.getByLabelText(/Profile ID/i)).toHaveValue("adult-basic");
    expect(screen.getByLabelText(/Sample Interval/i)).toHaveValue("20");
    expect(screen.getByLabelText(/Calibration Window/i)).toHaveValue("3000");
  });

  it("blocks calibration start and shows inline messages on invalid values", async () => {
    render(<CalibrationWizardPage deviceId="MAN-01" onBack={vi.fn()} />);
    await screen.findByText("Calibration / Pre-Check");

    const hallInput = screen.getByLabelText(/Hall Delta/i);
    await userEvent.clear(hallInput);
    await userEvent.type(hallInput, "0");

    const startBtn = screen.getByRole("button", { name: "Start Calibration" });
    await userEvent.click(startBtn);

    expect(screen.getByText("Hall Delta must be greater than 0")).toBeInTheDocument();
    expect(startCalibration).not.toHaveBeenCalled();
  });

  it("calls startCalibration API with snake_case keys when valid", async () => {
    vi.mocked(startCalibration).mockResolvedValue({
      deviceId: "MAN-01",
      requestId: "req-1",
      command: "start",
      status: "PUBLISHED",
    });

    render(<CalibrationWizardPage deviceId="MAN-01" onBack={vi.fn()} />);
    await screen.findByText("Calibration / Pre-Check");

    const startBtn = screen.getByRole("button", { name: "Start Calibration" });
    await userEvent.click(startBtn);

    await waitFor(() => {
      expect(startCalibration).toHaveBeenCalledWith("MAN-01", {
        hall_delta: 13500,
        ref_pressure: 20100,
        bladder_1_pressure: 15000,
        bladder_2_pressure: 15000,
        profile_id: "adult-basic",
        sample_interval_ms: 20,
        calibration_window_ms: 3000,
      });
    });

    // Forms should be disabled during run
    expect(screen.getByLabelText(/Hall Delta/i)).toBeDisabled();
  });

  it("updates page state and stepper on progress SSE updates", async () => {
    render(<CalibrationWizardPage deviceId="MAN-01" onBack={vi.fn()} />);
    await screen.findByText("Calibration / Pre-Check");

    // Simulate progress 2 (Reference pressure)
    await waitFor(() => expect(sseHandlers).not.toBeNull());
    act(() => {
      sseHandlers.onUpdate({
        type: "calibration_update",
        deviceId: "MAN-01",
        eventId: 4001,
        progressId: 2,
        calibrationState: "CALIBRATING",
        readyForSession: false,
      });
    });

    expect(await screen.findByText("Reference pressure")).toBeInTheDocument();
    expect(screen.getByText("Apply the required reference pressure to the reference chamber and hold it steady.")).toBeInTheDocument();

    // Simulate progress 9 (Full compression)
    act(() => {
      sseHandlers.onUpdate({
        type: "calibration_update",
        deviceId: "MAN-01",
        eventId: 4001,
        progressId: 9,
        calibrationState: "CALIBRATING",
        readyForSession: false,
      });
    });

    expect(await screen.findByText("Full compression")).toBeInTheDocument();
    expect(screen.getByText("Press and hold full compression until the firmware captures the full press.")).toBeInTheDocument();
  });

  it("handles final PASS and navigates back on Start Session click", async () => {
    const onBackMock = vi.fn();
    render(<CalibrationWizardPage deviceId="MAN-01" onBack={onBackMock} />);
    await screen.findByText("Calibration / Pre-Check");

    await waitFor(() => expect(sseHandlers).not.toBeNull());
    act(() => {
      sseHandlers.onFinal({
        type: "calibration_final",
        deviceId: "MAN-01",
        eventId: 4002,
        result: "PASS",
        readyForSession: true,
        calibrationState: "READY",
      });
    });

    expect(await screen.findByText("Calibration Complete")).toBeInTheDocument();
    expect(screen.getByText("Calibration complete. Device is ready for session.")).toBeInTheDocument();

    const startSessionBtn = screen.getByRole("button", { name: "Start Session" });
    await userEvent.click(startSessionBtn);
    expect(onBackMock).toHaveBeenCalled();
  });

  it("handles final FAIL and shows a Retry button", async () => {
    render(<CalibrationWizardPage deviceId="MAN-01" onBack={vi.fn()} />);
    await screen.findByText("Calibration / Pre-Check");

    await waitFor(() => expect(sseHandlers).not.toBeNull());
    act(() => {
      sseHandlers.onFinal({
        type: "calibration_final",
        deviceId: "MAN-01",
        eventId: 4002,
        result: "FAIL",
        readyForSession: false,
        calibrationState: "FAILED",
      });
    });

    expect(await screen.findByText("Calibration failed. Check the reason and follow the suggested action.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry Calibration" })).toBeInTheDocument();
  });

  it("calls cancel API on Cancel button click", async () => {
    vi.mocked(startCalibration).mockResolvedValue({
      deviceId: "MAN-01",
      requestId: "req-1",
      command: "start",
      status: "PUBLISHED",
    });

    vi.mocked(cancelCalibration).mockResolvedValue({
      deviceId: "MAN-01",
      requestId: "req-2",
      command: "cancel",
      status: "PUBLISHED",
    });

    render(<CalibrationWizardPage deviceId="MAN-01" onBack={vi.fn()} />);
    await screen.findByText("Calibration / Pre-Check");

    // Start calibration first to show the Cancel button
    const startBtn = screen.getByRole("button", { name: "Start Calibration" });
    await userEvent.click(startBtn);

    const cancelBtn = await screen.findByRole("button", { name: "Cancel Calibration" });
    await userEvent.click(cancelBtn);

    expect(cancelCalibration).toHaveBeenCalledWith("MAN-01");
  });

  it("closes EventSource on unmount", async () => {
    const { unmount } = render(<CalibrationWizardPage deviceId="MAN-01" onBack={vi.fn()} />);
    await screen.findByText("Calibration / Pre-Check");

    unmount();
    expect(mockClose).toHaveBeenCalled();
  });
});
