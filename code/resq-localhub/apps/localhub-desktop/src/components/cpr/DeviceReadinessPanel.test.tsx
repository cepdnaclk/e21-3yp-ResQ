import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DeviceReadinessPanel from "./DeviceReadinessPanel";
import { requestDebugSnapshot } from "../../api/firmwareApi";
import { cancelCalibration, startCalibration } from "../../api/manikinsApi";
import { connectCalibrationStream } from "../../api/liveEventsClient";
import { useCalibrationProfiles } from "../../hooks/useCalibrationProfiles";
import { useDeviceReadiness } from "../../hooks/useDeviceReadiness";

vi.mock("../../api/firmwareApi", () => ({
  requestDebugSnapshot: vi.fn(),
}));

vi.mock("../../api/manikinsApi", () => ({
  cancelCalibration: vi.fn(),
  startCalibration: vi.fn(),
}));

vi.mock("../../api/liveEventsClient", () => ({
  connectCalibrationStream: vi.fn(),
}));

vi.mock("../../hooks/useCalibrationProfiles", () => ({
  useCalibrationProfiles: vi.fn(),
}));

vi.mock("../../hooks/useDeviceReadiness", () => ({
  useDeviceReadiness: vi.fn(),
}));

const profile = {
  profileId: "profile-1",
  name: "Adult Basic",
  defaultProfile: true,
  hallDelta: 250,
  refPressure: 1000,
  bladder1Pressure: 1600,
  bladder2Pressure: 1600,
};

const liveSummary = {
  deviceId: "manikin-1",
  online: true,
  offline: false,
  stale: false,
  sessionActive: false,
  activeSessionId: null,
};

function mockReadiness(overrides: Record<string, unknown>) {
  vi.mocked(useDeviceReadiness).mockReturnValue({
    readiness: {
      deviceId: "manikin-1",
      firmwareState: "READY_FOR_SESSION",
      calibrationState: "PASSED",
      readyForSession: true,
      lastResult: "SUCCESS",
      currentProgressId: null,
      lastReasonId: null,
      lastActionId: null,
      lastUpdatedAt: null,
      ...overrides,
    },
    setReadiness: vi.fn(),
    loading: false,
    error: null,
    refetch: vi.fn(),
  } as any);
}

beforeEach(() => {
  vi.mocked(useCalibrationProfiles).mockReturnValue({
    profiles: [profile],
    defaultProfile: profile,
    loading: false,
    error: null,
    refetch: vi.fn(),
  } as any);
  mockReadiness({});
  vi.mocked(connectCalibrationStream).mockReturnValue({ close: vi.fn() } as any);
  vi.mocked(startCalibration).mockResolvedValue({ ok: true } as any);
  vi.mocked(cancelCalibration).mockResolvedValue({ ok: true } as any);
  vi.mocked(requestDebugSnapshot).mockResolvedValue(undefined as any);
});

describe("DeviceReadinessPanel", () => {
  it("shows a no-device prompt before hooks are needed", () => {
    render(<DeviceReadinessPanel deviceId="" liveSummary={null} onContinue={vi.fn()} />);
    expect(screen.getByText("Select a manikin to run readiness check.")).toBeInTheDocument();
  });

  it("renders ready state and allows continuing", () => {
    const onContinue = vi.fn();
    render(<DeviceReadinessPanel deviceId="manikin-1" liveSummary={liveSummary as any} onContinue={onContinue} continueLabel="Launch" />);

    expect(screen.getByText("Ready for Session")).toBeInTheDocument();
    expect(screen.getByText("Adult Basic")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Launch"));
    expect(onContinue).toHaveBeenCalled();
  });

  it("starts calibration with profile values and blocks invalid custom overrides", async () => {
    mockReadiness({ firmwareState: "IDLE", calibrationState: "REQUIRED", readyForSession: false, lastResult: null });
    render(<DeviceReadinessPanel deviceId="manikin-1" liveSummary={liveSummary as any} onContinue={vi.fn()} />);

    expect(screen.getByText("Calibration Required")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Advanced Calibration Values"));
    fireEvent.change(screen.getByDisplayValue("250"), { target: { value: "0" } });
    expect(screen.getByText(/positive numbers/)).toBeInTheDocument();
    expect(screen.getByText("Start Calibration")).toBeDisabled();

    fireEvent.change(screen.getByDisplayValue("0"), { target: { value: "300" } });
    fireEvent.click(screen.getByText("Start Calibration"));

    await waitFor(() => {
      expect(startCalibration).toHaveBeenCalledWith("manikin-1", {
        profile_id: "profile-1",
        hall_delta: 300,
        ref_pressure: 1000,
        bladder_1_pressure: 1600,
        bladder_2_pressure: 1600,
      });
    });
  });

  it("cancels an in-progress calibration", async () => {
    mockReadiness({
      firmwareState: "CALIBRATING",
      calibrationState: "RUNNING",
      readyForSession: false,
      currentProgressId: 3,
    });
    render(<DeviceReadinessPanel deviceId="manikin-1" liveSummary={liveSummary as any} onContinue={vi.fn()} />);

    expect(screen.getByText("Pre-Check Running")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel Calibration"));

    await waitFor(() => expect(cancelCalibration).toHaveBeenCalledWith("manikin-1"));
  });

  it("requests debug snapshots from failed and error states", async () => {
    mockReadiness({
      firmwareState: "IDLE",
      calibrationState: "FAILED",
      readyForSession: false,
      lastResult: "FAIL",
      lastReasonId: "pressure_invalid",
      lastActionId: 10,
    });
    const { unmount } = render(<DeviceReadinessPanel deviceId="manikin-1" liveSummary={liveSummary as any} onContinue={vi.fn()} />);

    expect(screen.getByText("Pre-Check Failed")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Request Debug/i));
    await waitFor(() => expect(requestDebugSnapshot).toHaveBeenCalledWith("manikin-1"));
    unmount();

    mockReadiness({
      firmwareState: "ERROR",
      calibrationState: "ERROR",
      readyForSession: false,
      lastResult: null,
      lastReasonId: "firmware_error",
    });
    render(<DeviceReadinessPanel deviceId="manikin-1" liveSummary={liveSummary as any} onContinue={vi.fn()} />);
    expect(screen.getByText("Firmware Needs Attention")).toBeInTheDocument();
  });

  it("surfaces profile load errors, offline and active-session states, stream errors, and back navigation", () => {
    const refetchProfiles = vi.fn();
    vi.mocked(useCalibrationProfiles).mockReturnValue({
      profiles: [],
      defaultProfile: null,
      loading: false,
      error: "Profiles unavailable",
      refetch: refetchProfiles,
    } as any);
    vi.mocked(connectCalibrationStream).mockImplementation(() => {
      throw new Error("stream unavailable");
    });
    mockReadiness({ firmwareState: "IDLE", calibrationState: "REQUIRED", readyForSession: false });
    const onBack = vi.fn();
    const { unmount } = render(
      <DeviceReadinessPanel
        deviceId="manikin-1"
        liveSummary={{ ...liveSummary, online: false, offline: true } as any}
        onContinue={vi.fn()}
        showBack
        onBack={onBack}
      />,
    );

    expect(screen.getByText("Live calibration updates could not be opened.")).toBeInTheDocument();
    expect(screen.getByText("Device Offline")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Retry Loading Profiles"));
    expect(refetchProfiles).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Back"));
    expect(onBack).toHaveBeenCalled();
    unmount();

    vi.mocked(useCalibrationProfiles).mockReturnValue({
      profiles: [profile],
      defaultProfile: profile,
      loading: false,
      error: null,
      refetch: vi.fn(),
    } as any);
    vi.mocked(connectCalibrationStream).mockReturnValue({ close: vi.fn() } as any);
    render(
      <DeviceReadinessPanel
        deviceId="manikin-1"
        liveSummary={{ ...liveSummary, sessionActive: true, activeSessionId: "s1" } as any}
        onContinue={vi.fn()}
      />,
    );
    expect(screen.getByText("Active Practice Session")).toBeInTheDocument();
  });
});
