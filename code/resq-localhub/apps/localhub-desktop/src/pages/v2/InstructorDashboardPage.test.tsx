import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import InstructorDashboardPage from "./InstructorDashboardPage";
import { fetchLiveManikins, getDeviceReadiness } from "../../api/manikinsApi";
import { fetchCourses } from "../../api/coursesApi";
import { fetchTrainees } from "../../api/traineesApi";
import { fetchCompletedSessions } from "../../api/sessionsApi";
import { subscribeToManikinsLive } from "../../api/liveEventsClient";

vi.mock("../../api/manikinsApi", () => ({
  fetchLiveManikins: vi.fn(),
  getDeviceReadiness: vi.fn(),
}));

vi.mock("../../api/coursesApi", () => ({
  fetchCourses: vi.fn(),
}));

vi.mock("../../api/traineesApi", () => ({
  fetchTrainees: vi.fn(),
}));

vi.mock("../../api/sessionsApi", () => ({
  fetchCompletedSessions: vi.fn(),
  startSession: vi.fn(),
}));

vi.mock("../../api/liveEventsClient", () => ({
  subscribeToManikinsLive: vi.fn(() => ({
    stop: vi.fn(),
  })),
}));

const mockManikin = {
  deviceId: "MAN-01",
  profileId: "adult-basic",
  online: true,
  lastSeen: new Date().toISOString(),
  state: "READY_FOR_SESSION",
  ip: "192.168.1.100",
  fw: "1.0.0",
  rssi: -50,
  battery: 100,
  sessionActive: null,
  latestDepthMm: 0,
  latestDepthProgress: 0,
  latestCompressionCount: 0,
  latestRateCpm: 0,
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
  connectionState: "ONLINE",
  stale: false,
  offline: false,
};

describe("InstructorDashboardPage V2", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fetchLiveManikins).mockResolvedValue([mockManikin]);
    vi.mocked(subscribeToManikinsLive).mockReturnValue({ stop: vi.fn() });
    vi.mocked(fetchCourses).mockResolvedValue([
      { courseId: "course-1", courseCode: "C01", title: "Course 1" },
    ]);
    vi.mocked(fetchTrainees).mockResolvedValue([
      { id: "trainee-1", displayName: "Trainee 1", traineeCode: "T01" },
    ]);
    vi.mocked(fetchCompletedSessions).mockResolvedValue([]);
  });

  it("disables Start Session button on the device card when not ready", async () => {
    vi.mocked(getDeviceReadiness).mockResolvedValue({
      deviceId: "MAN-01",
      calibrationState: "NOT_READY",
      readyForSession: false,
    });

    render(
      <InstructorDashboardPage
        onStartSession={vi.fn()}
        onRunReadinessCheck={vi.fn()}
        onRunCalibration={vi.fn()}
        onPairNewManikin={vi.fn()}
        onViewRecentSessions={vi.fn()}
      />
    );

    // Verify card is rendered
    expect(await screen.findByText("MAN-01")).toBeInTheDocument();
    
    // Check that getDeviceReadiness was called
    await waitFor(() => {
      expect(getDeviceReadiness).toHaveBeenCalledWith("MAN-01");
    });

    // Verify readiness badge shows "Not calibrated"
    expect(await screen.findByText("Not calibrated")).toBeInTheDocument();

    // Verify button is disabled
    const startBtn = screen.getByRole("button", { name: "Start Session" });
    expect(startBtn).toBeDisabled();

    // Verify warning text is displayed
    expect(screen.getByText("Run calibration before starting a CPR session.")).toBeInTheDocument();
  });

  it("disables the Start Live Session modal submit button when the selected device is not ready", async () => {
    let callCount = 0;
    vi.mocked(getDeviceReadiness).mockImplementation(async (deviceId) => {
      callCount++;
      if (callCount === 1) {
        return {
          deviceId,
          calibrationState: "READY",
          readyForSession: true,
        };
      } else {
        return {
          deviceId,
          calibrationState: "FAILED",
          readyForSession: false,
        };
      }
    });

    render(
      <InstructorDashboardPage
        onStartSession={vi.fn()}
        onRunReadinessCheck={vi.fn()}
        onRunCalibration={vi.fn()}
        onPairNewManikin={vi.fn()}
        onViewRecentSessions={vi.fn()}
      />
    );

    expect(await screen.findByText("MAN-01")).toBeInTheDocument();
    
    // Badge shows Ready initially (use findAllByText since state badge is also "Ready")
    const readyBadges = await screen.findAllByText("Ready");
    expect(readyBadges.length).toBeGreaterThanOrEqual(1);

    const startBtn = screen.getByRole("button", { name: "Start Session" });
    expect(startBtn).toBeEnabled();

    // Click to open the modal
    await userEvent.click(startBtn);

    // Verify modal title is displayed
    expect(await screen.findByText("Start CPR Training Session")).toBeInTheDocument();

    // Check that second call was made
    await waitFor(() => {
      expect(callCount).toBeGreaterThanOrEqual(2);
    });

    // Submit button in modal should be disabled
    const modalSubmitBtn = screen.getByRole("button", { name: "Start Live Session" });
    expect(modalSubmitBtn).toBeDisabled();

    // Warning message should be shown in modal
    expect(screen.getByText("Run calibration before starting a CPR session.")).toBeInTheDocument();
  });
});
