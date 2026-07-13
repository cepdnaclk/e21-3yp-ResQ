import { render, screen, waitFor, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import CalibrationWizardPage from "./CalibrationWizardPage";
import { getDeviceReadiness, startCalibration, cancelCalibration, getLatestCalibrationEvidence } from "../../api/manikinsApi";
import { connectCalibrationStream } from "../../api/liveEventsClient";

vi.mock("../../api/manikinsApi", () => ({
  getDeviceReadiness: vi.fn(),
  startCalibration: vi.fn(),
  cancelCalibration: vi.fn(),
  getLatestCalibrationEvidence: vi.fn(),
}));

vi.mock("../../api/liveEventsClient", () => ({
  connectCalibrationStream: vi.fn(),
}));

const MOCK_EVIDENCE = {
  id: 42,
  deviceId: "MAN-01",
  requestId: "req-abc-001",
  startedAt: "2026-06-01T10:00:00Z",
  completedAt: "2026-06-01T10:05:00Z",
  finalResult: "PASS",
  calibrationState: "READY_FOR_SESSION",
  readyForSessionAtCompletion: true,
  lastProgressId: 11,
  lastReasonId: "00000",
  lastActionId: 0,
  firmwareState: "READY_FOR_SESSION",
  profileId: "adult-basic",
  hallDelta: 13500,
  refPressure: 20100,
  bladder1Pressure: 15000,
  bladder2Pressure: 15000,
  sampleIntervalMs: 20,
  calibrationWindowMs: 3000,
  createdByUsername: "instructor1",
  createdAt: "2026-06-01T10:00:00Z",
  updatedAt: "2026-06-01T10:05:00Z",
};

async function openAdvancedConfiguration() {
  await userEvent.click(screen.getByText("Advanced Calibration Configuration"));
}

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

    vi.mocked(getLatestCalibrationEvidence).mockResolvedValue(null);

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
    expect(screen.getByText("Advanced Calibration Configuration")).toBeInTheDocument();
    await openAdvancedConfiguration();
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
    await openAdvancedConfiguration();

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
    await openAdvancedConfiguration();

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

  it("renders converted 4001 pressure and Hall measurements independently", async () => {
    render(<CalibrationWizardPage deviceId="MAN-01" onBack={vi.fn()} />);
    await screen.findByText("Calibration / Pre-Check");
    await waitFor(() => expect(sseHandlers).not.toBeNull());

    act(() => {
      sseHandlers.onUpdate({
        type: "calibration_update",
        deviceId: "MAN-01",
        eventId: 4001,
        progressId: 5,
        calibrationState: "CALIBRATING",
        readyForSession: false,
        pressure0Kpa: 0,
        pressure0KpaValid: true,
        pressure1Kpa: 4.25,
        pressure1KpaValid: false,
        pressure2Kpa: 9.49,
        pressure2KpaValid: true,
        pressureKpaValid: false,
        hallMm: 18.4,
        hallProgress: 0.42,
        hallMmValid: true,
        samplePressureKpaValid: true,
        sampleHallMmValid: true,
        pressureSaturationMask: 0,
        fullDepthMm: 44.8,
      });
    });

    expect(within(screen.getByRole("group", { name: "Pressure 0" })).getByText("0.0 kPa")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Pressure 1" })).getByText("Unavailable")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Pressure 2" })).getByText("9.5 kPa")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Hall" })).getByText("18.4 mm")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Hall" })).getByText("Progress: 42%")).toBeInTheDocument();
  });

  it("shows saturation before validity and does not display invalid numeric zero", async () => {
    render(<CalibrationWizardPage deviceId="MAN-01" onBack={vi.fn()} />);
    await screen.findByText("Calibration / Pre-Check");
    await waitFor(() => expect(sseHandlers).not.toBeNull());

    act(() => {
      sseHandlers.onUpdate({
        type: "calibration_update",
        deviceId: "MAN-01",
        eventId: 4001,
        progressId: 2,
        calibrationState: "CALIBRATING",
        readyForSession: false,
        pressure0Kpa: 0,
        pressure0KpaValid: false,
        pressure1Kpa: 0,
        pressure1KpaValid: true,
        pressure2Kpa: 0,
        pressure2KpaValid: false,
        sampleHallMmValid: false,
        pressureSaturationMask: 4,
      });
    });

    expect(within(screen.getByRole("group", { name: "Pressure 0" })).getByText("Unavailable")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Pressure 1" })).getByText("0.0 kPa")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Pressure 2" })).getByText("Saturated")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Hall" })).getByText("Unavailable")).toBeInTheDocument();
  });

  it("keeps HTTP start in STARTING until the 4000 ACK enters RUNNING", async () => {
    vi.mocked(startCalibration).mockResolvedValue({
      deviceId: "MAN-01",
      requestId: "req-1",
      command: "start",
      status: "PUBLISHED",
    });

    render(<CalibrationWizardPage deviceId="MAN-01" onBack={vi.fn()} />);
    await screen.findByText("Calibration / Pre-Check");
    await userEvent.click(screen.getByRole("button", { name: "Start Calibration" }));

    expect(await screen.findByText("Start command published")).toBeInTheDocument();
    expect(screen.getAllByText("STARTING").length).toBeGreaterThan(0);

    act(() => {
      sseHandlers.onUpdate({
        type: "calibration_update",
        deviceId: "MAN-01",
        eventId: 4000,
        replyId: "req-1",
        status: "ACK",
        calibrationState: "STARTING",
        readyForSession: false,
      });
    });

    await waitFor(() => expect(screen.getAllByText("RUNNING").length).toBeGreaterThan(0));
    expect(screen.getAllByText("req-1").length).toBeGreaterThan(0);
  });

  it("displays Hall noise reason 08418 with the specific suggested action", async () => {
    render(<CalibrationWizardPage deviceId="MAN-01" onBack={vi.fn()} />);
    await screen.findByText("Calibration / Pre-Check");
    await waitFor(() => expect(sseHandlers).not.toBeNull());

    act(() => {
      sseHandlers.onFinal({
        type: "calibration_final",
        deviceId: "MAN-01",
        eventId: 4002,
        replyId: "req-noisy",
        result: "FAIL",
        reasonId: "08418",
        actionId: 4,
        progressId: 12,
        readyForSession: false,
        calibrationState: "FAILED",
      });
    });

    expect(await screen.findByText("Hall sensor signal is too noisy")).toBeInTheDocument();
    expect(screen.getByText("Reason ID: 08418")).toBeInTheDocument();
    expect(screen.getAllByText(/Keep the manikin completely still during baseline capture/i).length).toBeGreaterThan(0);
    expect(screen.queryByText("Check the sensor connection and retry.")).not.toBeInTheDocument();
  });

  it("keeps final 4002 FAIL result and reply ID after progress updates", async () => {
    render(<CalibrationWizardPage deviceId="MAN-01" onBack={vi.fn()} />);
    await screen.findByText("Calibration / Pre-Check");
    await waitFor(() => expect(sseHandlers).not.toBeNull());

    act(() => {
      sseHandlers.onFinal({
        type: "calibration_final",
        deviceId: "MAN-01",
        eventId: 4002,
        replyId: "req-final",
        result: "FAIL",
        reasonId: "08418",
        progressId: 12,
        readyForSession: false,
        calibrationState: "FAILED",
      });
    });

    await waitFor(() => expect(screen.getAllByText("req-final").length).toBeGreaterThan(0));
    expect(screen.getByText("FAIL")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry Calibration" })).toBeInTheDocument();
  });

  it("does not mark Save / Result complete when failure progress 12 arrives", async () => {
    render(<CalibrationWizardPage deviceId="MAN-01" onBack={vi.fn()} />);
    await screen.findByText("Calibration / Pre-Check");
    await waitFor(() => expect(sseHandlers).not.toBeNull());

    act(() => {
      sseHandlers.onUpdate({
        type: "calibration_update",
        deviceId: "MAN-01",
        eventId: 4001,
        progressId: 10,
        calibrationState: "CALIBRATING",
        readyForSession: false,
      });
      sseHandlers.onUpdate({
        type: "calibration_update",
        deviceId: "MAN-01",
        eventId: 4001,
        progressId: 12,
        reasonId: "08418",
        calibrationState: "FAILED",
        readyForSession: false,
      });
    });

    expect(await screen.findByText("Calibration failed. Check the reason and follow the suggested action.")).toBeInTheDocument();
    expect(screen.getByText("Save / Result")).toHaveClass("text-slate-400");
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

  // ---------------------------------------------------------------------------
  // Historical Calibration Evidence panel (Phase 8)
  // ---------------------------------------------------------------------------

  it("renders the Historical Calibration Evidence card label on mount", async () => {
    render(<CalibrationWizardPage deviceId="MAN-01" onBack={vi.fn()} />);
    expect(await screen.findByText("Historical Calibration Evidence")).toBeInTheDocument();
  });

  it("renders evidence data when getLatestCalibrationEvidence returns a record", async () => {
    vi.mocked(getLatestCalibrationEvidence).mockResolvedValue(MOCK_EVIDENCE);

    render(<CalibrationWizardPage deviceId="MAN-01" onBack={vi.fn()} />);
    await screen.findByText("Historical Calibration Evidence");

    // Should show the attempt ID and request ID
    expect(await screen.findByText("#42")).toBeInTheDocument();
    expect(screen.getByText("req-abc-001")).toBeInTheDocument();

    // Should show operator
    expect(screen.getByText("instructor1")).toBeInTheDocument();

    // Should show readyAtCompletion as YES
    expect(screen.getByText("YES")).toBeInTheDocument();

    // Panel description must be visible and clearly label this as historical (not live)
    expect(
      screen.getByText(/audit log of the last recorded calibration attempt/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/fresh calibration must succeed before a session can start/i)
    ).toBeInTheDocument();
  });

  it("shows empty state text when no evidence exists", async () => {
    vi.mocked(getLatestCalibrationEvidence).mockResolvedValue(null);

    render(<CalibrationWizardPage deviceId="MAN-01" onBack={vi.fn()} />);
    await screen.findByText("Historical Calibration Evidence");

    expect(
      await screen.findByText(/no historical calibration evidence found/i)
    ).toBeInTheDocument();
  });

  it("refetches evidence after a final SSE event", async () => {
    vi.mocked(getLatestCalibrationEvidence).mockResolvedValue(null);

    render(<CalibrationWizardPage deviceId="MAN-01" onBack={vi.fn()} />);
    await screen.findByText("Historical Calibration Evidence");

    // Initial call on mount
    expect(getLatestCalibrationEvidence).toHaveBeenCalledTimes(1);

    // Now simulate a final SSE event
    await waitFor(() => expect(sseHandlers).not.toBeNull());

    // Update mock before triggering the event so the refetch returns data
    vi.mocked(getLatestCalibrationEvidence).mockResolvedValue(MOCK_EVIDENCE);
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

    // Evidence should be refetched after final event
    await waitFor(() => {
      expect(getLatestCalibrationEvidence).toHaveBeenCalledTimes(2);
    });
  });

  it("evidence panel does not show readyForSession as live readiness label", async () => {
    vi.mocked(getLatestCalibrationEvidence).mockResolvedValue(MOCK_EVIDENCE);

    render(<CalibrationWizardPage deviceId="MAN-01" onBack={vi.fn()} />);
    await screen.findByText("Historical Calibration Evidence");

    // The historical panel heading must never read "Device Readiness State" or "Live Readiness"
    const headings = screen.queryAllByText(/live readiness/i);
    expect(headings).toHaveLength(0);

    // The evidence header title must be "Historical Calibration Evidence", not a live-readiness label
    expect(screen.getByText("Historical Calibration Evidence")).toBeInTheDocument();
  });
});
