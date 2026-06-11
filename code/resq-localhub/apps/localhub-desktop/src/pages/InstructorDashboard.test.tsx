import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InstructorDashboard from "./InstructorDashboard";
import { fetchBrowserHealth } from "../lib/browserHealthApi";
import { fetchLiveManikins, getLiveManikinsStreamUrl } from "../lib/browserManikinsApi";
import {
  endSession,
  fetchCompletedSession,
  fetchCompletedSessions,
  startSession,
} from "../lib/browserSessionsApi";
import { getReadiness } from "../lib/browserFirmwareApi";
import { listCourses, listCourseStudents } from "../lib/browserRosterSyncApi";

vi.mock("../lib/browserHealthApi", () => ({
  fetchBrowserHealth: vi.fn(),
}));

vi.mock("../lib/browserRosterSyncApi", () => ({
  listCourses: vi.fn(),
  listCourseStudents: vi.fn(),
  listCourseInstructors: vi.fn(() => Promise.resolve([])),
  getRosterSyncStatus: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    currentUser: {
      id: "instructor-1",
      username: "instructor",
      displayName: "Instructor",
      role: "INSTRUCTOR",
      disabledAt: null,
    },
    logout: vi.fn(),
  }),
}));

vi.mock("../hooks/useLiveSession", () => ({
  useLiveSession: vi.fn(() => ({
    deviceId: "MAN-01",
    sessionId: null,
    latestMetric: null,
    lastSeenAt: null,
    connectionState: "OFFLINE",
    sourceMode: "NONE",
    stale: false,
    offline: true,
    message: null,
    lastHeartbeatAt: null,
    lastStatusAt: null,
    lastEventType: null,
    firmwareState: null,
    calibrated: null,
    sessionActive: null,
    lastErrorId: null,
    eventId: null,
    reasonId: null,
    actionId: null,
    progressId: null,
    error: null,
  })),
}));

vi.mock("../lib/browserManikinsApi", () => ({
  fetchLiveManikins: vi.fn(),
  getLiveManikinsStreamUrl: vi.fn(() => "http://localhost:18080/api/stream/manikins/live"),
}));

vi.mock("../lib/browserSessionsApi", () => ({
  startSession: vi.fn(),
  endSession: vi.fn(),
  fetchCompletedSessions: vi.fn(),
  fetchCompletedSession: vi.fn(),
  getSessionCsvExportUrl: vi.fn((sessionId: string) => `http://localhost:18080/api/export/sessions/${sessionId}.csv`),
  getSessionJsonExportUrl: vi.fn((sessionId: string) => `http://localhost:18080/api/export/sessions/${sessionId}.json`),
}));

vi.mock("../lib/browserFirmwareApi", () => ({
  getReadiness: vi.fn(),
  startCalibration: vi.fn(),
  cancelCalibration: vi.fn(),
}));

class MockEventSource {
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(_url: string) {}

  addEventListener(_eventName: string, _handler: EventListener): void {}

  close(): void {}
}

function setEventSource(value: typeof EventSource | undefined): void {
  Object.defineProperty(window, "EventSource", {
    configurable: true,
    writable: true,
    value,
  });

  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    writable: true,
    value,
  });
}

const baseManikin = {
  deviceId: "MAN-01",
  online: true,
  lastSeen: new Date().toISOString(),
  state: "ready",
  ip: "192.168.1.22",
  fw: "1.0.0",
  rssi: -55,
  battery: 92,
  sessionActive: null,
  latestDepthMm: 55,
  latestRateCpm: 110,
  latestRecoilOk: true,
  latestPauseS: 0.5,
  latestFlags: null,
  lastEventType: "compression",
  latestForce1: 20,
  latestForce2: 20,
  pressureBalancePct: 100,
  pressureSkewed: false,
  activeSessionId: null,
  activeTraineeId: null,
  activeSessionStartedAt: null,
  activeSessionScenario: null,
};

describe("InstructorDashboard", () => {
  beforeEach(() => {
    setEventSource(MockEventSource as unknown as typeof EventSource);

    vi.mocked(fetchBrowserHealth).mockResolvedValue({
      ok: true,
      service: "hub-api",
      timestamp: new Date().toISOString(),
    });

    vi.mocked(fetchLiveManikins).mockResolvedValue([]);
    vi.mocked(fetchCompletedSessions).mockResolvedValue([]);
    vi.mocked(fetchCompletedSession).mockResolvedValue(null as never);
    vi.mocked(listCourses).mockResolvedValue([
      {
        cloudCourseId: "course-123",
        courseCode: "RSQ-101",
        title: "Introduction to ResQ",
        description: "Intro course",
        instructorCloudUserId: "instructor-1",
        active: true,
      },
    ]);
    vi.mocked(listCourseStudents).mockResolvedValue([
      {
        cloudUserId: "trainee-123",
        displayName: "Trainee One",
        email: "trainee1@example.com",
        enrolledAt: new Date().toISOString(),
      },
    ]);
    vi.mocked(getReadiness).mockResolvedValue({
      deviceId: "MAN-01",
      firmwareState: null,
      calibrated: false,
      readyForSession: false,
      latestResult: null,
      progressId: null,
      reasonId: null,
      actionId: null,
      tsMs: null,
      receivedAt: null,
      sessionId: null,
      latestErrorId: null,
    });
    vi.mocked(startSession).mockResolvedValue({
      sessionId: "sess-001",
      deviceId: "MAN-01",
      traineeId: "trainee-man-01",
      startedAt: new Date().toISOString(),
      active: true,
      scenario: null,
      notes: null,
    });
    vi.mocked(endSession).mockResolvedValue({
      sessionId: "sess-001",
      deviceId: "MAN-01",
      traineeId: "trainee-man-01",
      startedAt: new Date(Date.now() - 15000).toISOString(),
      ended: true,
      endedAt: new Date().toISOString(),
      scenario: null,
      notes: null,
      summary: {
        sessionId: "sess-001",
        deviceId: "MAN-01",
        traineeId: "trainee-man-01",
        startedAt: new Date(Date.now() - 15000).toISOString(),
        endedAt: new Date().toISOString(),
        durationSeconds: 15,
        avgDepthMm: 55,
        avgRateCpm: 110,
        recoilPct: 98,
        pausesCount: 0,
        score: 95,
        latestFlags: null,
      },
    });
  });

  it("shows healthy status when health endpoint returns ok", async () => {
    render(<InstructorDashboard embeddedInDesktop />);

    expect(await screen.findByText("Healthy")).toBeInTheDocument();
  });

  it("shows stream unavailable when EventSource is not available", async () => {
    setEventSource(undefined);

    render(<InstructorDashboard embeddedInDesktop />);

    expect(await screen.findByText("Stream unavailable")).toBeInTheDocument();
    expect(getLiveManikinsStreamUrl).not.toHaveBeenCalled();
  });

  it("starts a session for a manikin", async () => {
    vi.mocked(fetchLiveManikins).mockResolvedValue([{ ...baseManikin }]);

    render(<InstructorDashboard embeddedInDesktop />);

    expect(await screen.findByRole("heading", { name: "MAN-01" })).toBeInTheDocument();
    
    const courseSelect = await screen.findByLabelText("Select Course");
    await userEvent.selectOptions(courseSelect, "course-123");

    const traineeSelect = await screen.findByLabelText("Select Trainee");
    await userEvent.selectOptions(traineeSelect, "trainee-123");

    await userEvent.click(screen.getByRole("button", { name: "Start Session" }));

    await waitFor(() => {
      expect(startSession).toHaveBeenCalledWith({
        deviceId: "MAN-01",
        courseId: "course-123",
        traineeId: "trainee-123",
        scenario: null,
        notes: null,
      });
    });

    expect(await screen.findByText(/Started session sess-001/i)).toBeInTheDocument();
  });

  it("enables session start when firmware is ready despite stale calibration status", async () => {
    vi.mocked(fetchLiveManikins).mockResolvedValue([{ ...baseManikin, state: "READY_FOR_SESSION" }]);
    vi.mocked(getReadiness).mockResolvedValue({
      deviceId: "MAN-01",
      firmwareState: "READY_FOR_SESSION",
      calibrated: false,
      readyForSession: false,
      latestResult: "FAIL",
      progressId: 12,
      reasonId: "12345",
      actionId: 8,
      tsMs: 100,
      receivedAt: new Date().toISOString(),
      sessionId: null,
      latestErrorId: null,
    });

    render(<InstructorDashboard embeddedInDesktop />);

    const courseSelect = await screen.findByLabelText("Select Course");
    await userEvent.selectOptions(courseSelect, "course-123");

    const traineeSelect = await screen.findByLabelText("Select Trainee");
    await userEvent.selectOptions(traineeSelect, "trainee-123");

    const startButton = await screen.findByRole("button", { name: "Start Session" });
    await waitFor(() => expect(getReadiness).toHaveBeenCalledWith("MAN-01"));
    expect(startButton).toBeEnabled();
  });

  it("ends an active session", async () => {
    vi.mocked(fetchLiveManikins).mockResolvedValue([
      {
        ...baseManikin,
        activeSessionId: "sess-active-1",
        activeTraineeId: "trainee-123",
        activeSessionStartedAt: new Date(Date.now() - 30000).toISOString(),
        sessionActive: true,
      },
    ]);

    vi.mocked(endSession).mockResolvedValue({
      sessionId: "sess-active-1",
      deviceId: "MAN-01",
      traineeId: "trainee-123",
      startedAt: new Date(Date.now() - 30000).toISOString(),
      ended: true,
      endedAt: new Date().toISOString(),
      scenario: null,
      notes: null,
      summary: {
        sessionId: "sess-active-1",
        deviceId: "MAN-01",
        traineeId: "trainee-123",
        startedAt: new Date(Date.now() - 30000).toISOString(),
        endedAt: new Date().toISOString(),
        durationSeconds: 30,
        avgDepthMm: 56,
        avgRateCpm: 112,
        recoilPct: 97,
        pausesCount: 1,
        score: 93,
        latestFlags: null,
      },
    });

    render(<InstructorDashboard embeddedInDesktop />);

    const endButton = await screen.findByRole("button", { name: "End Session" });
    await userEvent.click(endButton);

    await waitFor(() => {
      expect(endSession).toHaveBeenCalledWith({ sessionId: "sess-active-1" });
    });

    expect(await screen.findByText(/Ended session sess-active-1/i)).toBeInTheDocument();
  });
});
