import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LocalHubHomePage from "./LocalHubHomePage";
import { getJson } from "../../api/localHubClient";
import { fetchLiveManikins } from "../../api/manikinsApi";
import { subscribeToManikinsLive } from "../../api/liveEventsClient";
import { fetchCompletedSessions, fetchSyncQueue } from "../../api/sessionsApi";
import { fetchTrainees } from "../../api/traineesApi";
import type { ManikinLiveSummary } from "../../types/manikin";
import type { CompletedSession, SyncQueueItem } from "../../types/session";

const { currentUserMock } = vi.hoisted(() => ({
  currentUserMock: {
    id: "u-1",
    username: "instructor",
    displayName: "Dr. Silva",
    role: "INSTRUCTOR",
    enabled: true,
  },
}));

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({
    currentUser: currentUserMock,
  }),
}));

vi.mock("../../api/localHubClient", () => ({
  getJson: vi.fn(),
}));

vi.mock("../../api/manikinsApi", () => ({
  fetchLiveManikins: vi.fn(),
}));

vi.mock("../../api/liveEventsClient", () => ({
  subscribeToManikinsLive: vi.fn(() => ({ stop: vi.fn() })),
}));

vi.mock("../../api/sessionsApi", () => ({
  fetchCompletedSessions: vi.fn(),
  fetchSyncQueue: vi.fn(),
}));

vi.mock("../../api/traineesApi", () => ({
  fetchTrainees: vi.fn(),
}));

const baseManikin: ManikinLiveSummary = {
  deviceId: "MAN-01",
  sessionId: null,
  manikinId: null,
  online: true,
  lastSeen: new Date().toISOString(),
  state: "READY_FOR_SESSION",
  ip: null,
  fw: null,
  rssi: -55,
  battery: 91,
  sessionActive: null,
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
  readyForSession: true,
  activeSessionId: null,
  activeTraineeId: null,
  activeSessionStartedAt: null,
  activeSessionScenario: null,
  latestMetric: null,
  seq: null,
  connectionState: "MQTT_WS_LIVE",
  stale: false,
  offline: false,
};

const activeManikin: ManikinLiveSummary = {
  ...baseManikin,
  deviceId: "MAN-02",
  state: "SESSION_ACTIVE",
  activeSessionId: "session-active",
  activeTraineeId: "trainee-1",
  activeSessionStartedAt: new Date().toISOString(),
  activeSessionScenario: "Assessment",
  latestCompressionCount: 12,
  latestDepthMm: 52,
  latestRateCpm: 108,
  latestRecoilOk: true,
  latestMetric: {} as ManikinLiveSummary["latestMetric"],
};

const completedSession: CompletedSession = {
  sessionId: "session-done",
  deviceId: "MAN-01",
  traineeId: "trainee-1",
  courseId: "course-1",
  instructorId: "u-1",
  startedAt: new Date(Date.now() - 120000).toISOString(),
  ended: true,
  endedAt: new Date().toISOString(),
  scenario: "Assessment",
  notes: null,
  summary: {
    sessionId: "session-done",
    deviceId: "MAN-01",
    traineeId: "trainee-1",
    startedAt: new Date(Date.now() - 120000).toISOString(),
    endedAt: new Date().toISOString(),
    durationSeconds: 120,
    sampleCount: 30,
    totalCompressions: 60,
    validCompressions: 55,
    avgDepthMm: 51,
    avgDepthProgress: null,
    avgRateCpm: 110,
    recoilPct: 95,
    recoilOkCount: 55,
    incompleteRecoilCount: 5,
    pausesCount: 0,
    score: 88,
    latestFlags: null,
  },
};

describe("LocalHubHomePage", () => {
  beforeEach(() => {
    currentUserMock.role = "INSTRUCTOR";
    currentUserMock.displayName = "Dr. Silva";
    vi.mocked(getJson).mockResolvedValue({ ok: true, service: "hub-api", timestamp: new Date().toISOString() });
    vi.mocked(fetchLiveManikins).mockResolvedValue([baseManikin, activeManikin]);
    vi.mocked(fetchCompletedSessions).mockResolvedValue([completedSession]);
    vi.mocked(fetchSyncQueue).mockResolvedValue([
      {
        id: "sync-1",
        entityType: "SESSION_SUMMARY",
        entityId: "session-done",
        payloadJson: "{}",
        syncStatus: "FAILED",
        retryCount: 1,
        lastError: "offline",
        createdAt: new Date().toISOString(),
        lastAttemptAt: null,
        syncedAt: null,
      } satisfies SyncQueueItem,
    ]);
    vi.mocked(fetchTrainees).mockResolvedValue([
      { id: "trainee-1", displayName: "Asha Perera", traineeCode: "T-1" },
    ]);
    vi.mocked(subscribeToManikinsLive).mockReturnValue({ stop: vi.fn() });
  });

  it("renders operational overview cards from API data", async () => {
    render(<LocalHubHomePage onOpenInstructorDashboard={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByText(/Welcome back, Dr\. Silva\./)).toBeInTheDocument();
    expect(screen.getByText(/Your CPR training environment is ready\./)).toBeInTheDocument();

    await waitFor(() => expect(fetchLiveManikins).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /Monitor Sessions/i })).toBeInTheDocument();
    expect(screen.getByText("Manikins")).toBeInTheDocument();
    expect(screen.getAllByText("Ready").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Active Sessions").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Asha Perera/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Training Floor")).toBeInTheDocument();
    expect(screen.getByText("Recent Sessions")).toBeInTheDocument();
    expect(screen.getByText("88%")).toBeInTheDocument();
    expect(screen.queryByText("Quick Actions")).not.toBeInTheDocument();
  });

  it("does not expose admin sync attention action to instructors", async () => {
    render(<LocalHubHomePage onOpenInstructorDashboard={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.queryByText("Open Sync")).not.toBeInTheDocument();
  });

  it("shows sync backlog only once for administrators", async () => {
    currentUserMock.role = "ADMIN";

    render(<LocalHubHomePage onOpenInstructorDashboard={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.queryByText("Sync Issues")).not.toBeInTheDocument();
    expect(screen.getAllByText("1 completed session need sync review.")).toHaveLength(1);
  });

  it("shows one Add Manikin action and neutral readiness when no manikins exist", async () => {
    vi.mocked(fetchLiveManikins).mockResolvedValueOnce([]);
    vi.mocked(fetchSyncQueue).mockResolvedValueOnce([]);

    render(<LocalHubHomePage onOpenInstructorDashboard={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add Manikin" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Manage Manikins" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View All Manikins" })).not.toBeInTheDocument();
    expect(screen.getByText("0 / 0")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("uses System Notices for pending sync only and preserves valid zero scores", async () => {
    currentUserMock.role = "ADMIN";
    vi.mocked(fetchLiveManikins).mockResolvedValueOnce([]);
    vi.mocked(fetchSyncQueue).mockResolvedValueOnce([
      {
        id: "sync-1",
        entityType: "SESSION_SUMMARY",
        entityId: "zero-score",
        payloadJson: "{}",
        syncStatus: "PENDING",
        retryCount: 0,
        lastError: null,
        createdAt: new Date().toISOString(),
        lastAttemptAt: null,
        syncedAt: null,
      } satisfies SyncQueueItem,
    ]);
    vi.mocked(fetchCompletedSessions).mockResolvedValueOnce([
      {
        ...completedSession,
        sessionId: "zero-score",
        summary: {
          ...completedSession.summary,
          sessionId: "zero-score",
          score: 0,
        },
      },
      {
        ...completedSession,
        sessionId: "missing-summary",
        traineeId: null,
        summary: undefined,
      } as CompletedSession,
    ]);

    render(<LocalHubHomePage onOpenInstructorDashboard={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "System Notices" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Attention Required" })).not.toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.getByText("Not scored")).toBeInTheDocument();
  });
});
