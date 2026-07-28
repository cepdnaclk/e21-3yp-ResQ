import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StartSessionWizardPage from "./StartSessionWizardPage";
import ManikinReadinessPage from "./ManikinReadinessPage";
import { fetchCourses, fetchCourseStudents } from "../../api/coursesApi";
import { fetchLiveManikin, fetchLiveManikins, getDeviceReadiness } from "../../api/manikinsApi";
import { startSession } from "../../api/sessionsApi";
import { subscribeToManikinsLive } from "../../api/liveEventsClient";
import { fetchDeviceDiagnostics, requestDebugSnapshot } from "../../api/firmwareApi";
import { useCalibrationProfiles } from "../../hooks/useCalibrationProfiles";

vi.mock("../../api/coursesApi", () => ({
  fetchCourses: vi.fn(),
  fetchCourseStudents: vi.fn(),
}));

vi.mock("../../api/manikinsApi", () => ({
  fetchLiveManikin: vi.fn(),
  fetchLiveManikins: vi.fn(),
  getDeviceReadiness: vi.fn(),
}));

vi.mock("../../api/sessionsApi", () => ({
  startSession: vi.fn(),
}));

vi.mock("../../api/liveEventsClient", () => ({
  subscribeToManikinsLive: vi.fn(),
}));

vi.mock("../../api/firmwareApi", () => ({
  fetchDeviceDiagnostics: vi.fn(),
  requestDebugSnapshot: vi.fn(),
}));

vi.mock("../../hooks/useCalibrationProfiles", () => ({
  useCalibrationProfiles: vi.fn(),
}));

vi.mock("../../components/cpr/DeviceReadinessPanel", () => ({
  DeviceReadinessPanel: ({ deviceId, onContinue, onBack, continueLabel, showBack }: any) => (
    <section>
      <h2>Readiness panel {deviceId}</h2>
      {showBack && <button onClick={onBack}>Panel back</button>}
      <button onClick={onContinue}>{continueLabel}</button>
    </section>
  ),
}));

const course = { cloudCourseId: "course-1", courseCode: "CPR101", title: "Adult CPR" };
const student = { cloudUserId: "student-1", displayName: "Sam Student", email: "sam@example.test" };
const readyManikin = {
  deviceId: "manikin-1",
  online: true,
  offline: false,
  stale: false,
  state: "READY_FOR_SESSION",
  readyForSession: true,
  profileId: "profile-1",
};
const readiness = { firmwareState: "READY_FOR_SESSION", readyForSession: true };
const profile = {
  profileId: "profile-1",
  name: "Adult Basic",
  refPressure: 1000,
  bladder1Pressure: 1600,
  bladder2Pressure: 1600,
  hallDelta: 250,
};

beforeEach(() => {
  vi.useRealTimers();
  window.history.replaceState({}, "", "/start-session");
  vi.mocked(fetchCourses).mockResolvedValue([course] as any);
  vi.mocked(fetchCourseStudents).mockResolvedValue([student] as any);
  vi.mocked(fetchLiveManikins).mockResolvedValue([readyManikin] as any);
  vi.mocked(fetchLiveManikin).mockResolvedValue(readyManikin as any);
  vi.mocked(getDeviceReadiness).mockResolvedValue(readiness as any);
  vi.mocked(startSession).mockResolvedValue({ sessionId: "session-1" } as any);
  vi.mocked(subscribeToManikinsLive).mockReturnValue({ stop: vi.fn() });
  vi.mocked(fetchDeviceDiagnostics).mockResolvedValue({
    debugSnapshots: [{ pressure0Raw: 1000, pressure1Raw: 1600, pressure2Raw: 1600 }],
  } as any);
  vi.mocked(requestDebugSnapshot).mockResolvedValue(undefined as any);
  vi.mocked(useCalibrationProfiles).mockReturnValue({
    profiles: [profile],
    defaultProfile: profile,
    loading: false,
    error: null,
    refetch: vi.fn(),
  } as any);
});

describe("StartSessionWizardPage and ManikinReadinessPage", () => {
  it("walks the start-session wizard and launches a ready manikin", async () => {
    render(<StartSessionWizardPage />);

    expect(await screen.findByText("Adult CPR")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Adult CPR"));

    expect(await screen.findByText("Sam Student")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Sam Student"));

    expect(await screen.findByText("manikin-1")).toBeInTheDocument();
    fireEvent.click(screen.getByText("manikin-1"));

    expect(screen.getByText("Readiness panel manikin-1")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Continue to Launch"));

    fireEvent.change(screen.getByDisplayValue("Adult CPR"), { target: { value: "Adult CPR assessment" } });
    fireEvent.change(screen.getByPlaceholderText(/clinical remarks/i), { target: { value: "Looks steady" } });
    fireEvent.click(screen.getByText("Start Live Session"));

    await waitFor(() => {
      expect(startSession).toHaveBeenCalledWith({
        deviceId: "manikin-1",
        courseId: "course-1",
        traineeId: "student-1",
        profileId: "profile-1",
        scenario: "Adult CPR assessment",
        notes: "Looks steady",
      });
    });
    expect(window.location.pathname).toBe("/instructor/sessions/session-1/live");
  });

  it("supports query preselection and launch validation failures", async () => {
    window.history.replaceState({}, "", "/start-session?courseId=course-1&traineeId=student-1");
    render(<StartSessionWizardPage />);

    expect(await screen.findByText("manikin-1")).toBeInTheDocument();
    fireEvent.click(screen.getByText("manikin-1"));
    fireEvent.click(screen.getByText("Continue to Launch"));

    vi.mocked(getDeviceReadiness).mockResolvedValueOnce({ firmwareState: "BOOTING", readyForSession: false } as any);
    fireEvent.click(screen.getByText("Start Live Session"));
    expect(await screen.findByText(/must be in READY_FOR_SESSION/)).toBeInTheDocument();
  });

  it("renders start-session empty and error states", async () => {
    vi.mocked(fetchCourses).mockResolvedValueOnce([]);
    const { unmount } = render(<StartSessionWizardPage />);
    expect(await screen.findByText(/No courses assigned yet/)).toBeInTheDocument();
    unmount();

    vi.mocked(fetchCourses).mockRejectedValueOnce(new Error("down"));
    render(<StartSessionWizardPage />);
    expect(await screen.findByText(/Failed to load starting wizard context/)).toBeInTheDocument();
  });

  it("renders readiness setup, saves good pressure targets, and opens readiness tab", async () => {
    const onBack = vi.fn();

    render(<ManikinReadinessPage deviceId="manikin-1" onBack={onBack} />);

    expect(await screen.findByText("Manikin Setup & Readiness")).toBeInTheDocument();
    expect(screen.getByText("Adult Basic")).toBeInTheDocument();
    expect(screen.getAllByText("Good range").length).toBeGreaterThanOrEqual(3);

    fireEvent.click(screen.getByText("Customize Target Levels"));
    fireEvent.change(screen.getAllByDisplayValue("1000")[0], { target: { value: "3000" } });
    expect(screen.getByText("Adjust")).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("3000"), { target: { value: "1000" } });
    fireEvent.click(screen.getByText("Save Pressure Setup"));
    expect(screen.getByText("Readiness panel manikin-1")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Start Training Session"));
    expect(onBack).toHaveBeenCalled();
  });

  it("renders readiness error, empty profile, and no-device states", async () => {
    vi.mocked(useCalibrationProfiles).mockReturnValue({
      profiles: [],
      defaultProfile: null,
      loading: false,
      error: "Failed to load calibration profiles.",
      refetch: vi.fn(),
    } as any);
    const { unmount } = render(<ManikinReadinessPage deviceId="manikin-1" onBack={vi.fn()} />);
    expect(await screen.findByText("Failed to Load Calibration Profiles")).toBeInTheDocument();
    unmount();

    vi.mocked(useCalibrationProfiles).mockReturnValue({
      profiles: [],
      defaultProfile: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    } as any);
    render(<ManikinReadinessPage deviceId="manikin-1" onBack={vi.fn()} />);
    expect(await screen.findByText("No Calibration Profiles Available")).toBeInTheDocument();
    unmount();

    render(<ManikinReadinessPage deviceId="" onBack={vi.fn()} />);
    expect(await screen.findByText("Select a manikin to run readiness check.")).toBeInTheDocument();
  });
});
