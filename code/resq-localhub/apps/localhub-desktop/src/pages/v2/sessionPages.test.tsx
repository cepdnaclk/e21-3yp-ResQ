import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ActiveSessionsPage from "./ActiveSessionsPage";
import RecentSessionsPage from "./RecentSessionsPage";
import SessionReviewPage from "./SessionReviewPage";
import AccessDeniedPage from "./AccessDeniedPage";
import { fetchLiveManikins } from "../../api/manikinsApi";
import { subscribeToManikinsLive } from "../../api/liveEventsClient";
import { fetchTrainees } from "../../api/traineesApi";
import {
  endSession,
  fetchAuthoritativeCompletedSession,
  fetchCompletedSessions,
  fetchSyncQueue,
} from "../../api/sessionsApi";
import { downloadSessionCsv, downloadSessionJson } from "../../api/exportsApi";
import { useAuth } from "../../auth/AuthContext";

vi.mock("../../api/manikinsApi", () => ({
  fetchLiveManikins: vi.fn(),
}));

vi.mock("../../api/liveEventsClient", () => ({
  subscribeToManikinsLive: vi.fn(),
}));

vi.mock("../../api/traineesApi", () => ({
  fetchTrainees: vi.fn(),
}));

vi.mock("../../api/sessionsApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/sessionsApi")>();
  return {
    ...actual,
    endSession: vi.fn(),
    fetchAuthoritativeCompletedSession: vi.fn(),
    fetchCompletedSessions: vi.fn(),
    fetchSyncQueue: vi.fn(),
  };
});

vi.mock("../../api/exportsApi", () => ({
  downloadSessionCsv: vi.fn(),
  downloadSessionJson: vi.fn(),
}));

vi.mock("../../auth/AuthContext", () => ({
  useAuth: vi.fn(),
}));

const liveManikin = {
  deviceId: "trainer-1",
  displayName: "Trainer One",
  online: true,
  offline: false,
  connectionState: "ONLINE",
  activeSessionId: "session-1",
  activeSessionStartedAt: new Date(Date.now() - 62_000).toISOString(),
  activeTraineeId: "trainee-1",
  activeSessionScenario: "Adult CPR",
  activeSessionLifecycleState: "ACTIVE",
  sessionActive: true,
  latestMetric: { compressionCount: 12 },
  latestDepthMm: 55,
  latestRateCpm: 110,
  latestRecoilOk: true,
  latestCompressionCount: 12,
  latestFlags: [],
};

const completedSession = {
  sessionId: "session-1",
  traineeId: "trainee-1",
  courseId: "course-a",
  scenario: "Adult CPR",
  startedAt: "2026-07-28T08:00:00Z",
  endedAt: "2026-07-28T08:02:00Z",
  notes: "Keep rhythm steady.",
  summary: {
    score: 82,
    durationSeconds: 120,
    avgDepthMm: 55,
    avgRateCpm: 110,
    recoilPct: 92,
    pausesCount: 1,
  },
};

beforeEach(() => {
  vi.mocked(fetchLiveManikins).mockResolvedValue([liveManikin as any]);
  vi.mocked(fetchTrainees).mockResolvedValue([{ id: "trainee-1", displayName: "Alex Trainee" }] as any);
  vi.mocked(subscribeToManikinsLive).mockReturnValue({ stop: vi.fn() });
  vi.mocked(endSession).mockResolvedValue({ state: "STOP_PENDING" } as any);
  vi.mocked(fetchCompletedSessions).mockResolvedValue([completedSession as any]);
  vi.mocked(fetchAuthoritativeCompletedSession).mockResolvedValue(completedSession as any);
  vi.mocked(fetchSyncQueue).mockResolvedValue([{ entityId: "session-1", syncStatus: "PENDING" }] as any);
  vi.mocked(useAuth).mockReturnValue({
    currentUser: { id: "admin", username: "admin", displayName: "Admin", role: "ADMIN" },
  } as any);
  vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal("alert", vi.fn());
});

describe("V2 session pages", () => {
  it("loads active sessions, filters by attention state, opens live view, and ends a session", async () => {
    const onViewLive = vi.fn();
    const onNavigateHome = vi.fn();

    render(<ActiveSessionsPage onViewLive={onViewLive} onNavigateHome={onNavigateHome} />);

    expect(screen.getByText("Loading active sessions...")).toBeInTheDocument();
    expect(await screen.findByText("Alex Trainee")).toBeInTheDocument();
    expect(screen.getByText("Adult CPR")).toBeInTheDocument();
    expect(screen.getAllByText("Good").length).toBeGreaterThan(1);

    fireEvent.click(screen.getByText("View Live"));
    expect(onViewLive).toHaveBeenCalledWith("session-1");

    fireEvent.click(screen.getByText("Needs Attention"));
    expect(screen.getByText("No live sessions match the selected filter.")).toBeInTheDocument();

    fireEvent.click(screen.getByText("All"));
    fireEvent.click(screen.getByText("End Session"));
    await waitFor(() => expect(endSession).toHaveBeenCalledWith({ sessionId: "session-1" }));
    expect(fetchLiveManikins).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByText("Back to Home"));
    expect(onNavigateHome).toHaveBeenCalled();
  });

  it("renders empty and error active-session states", async () => {
    vi.mocked(fetchLiveManikins).mockResolvedValueOnce([]);
    const { unmount } = render(<ActiveSessionsPage onViewLive={vi.fn()} onNavigateHome={vi.fn()} />);
    expect(await screen.findByText(/No live sessions right now/)).toBeInTheDocument();
    unmount();

    vi.mocked(fetchLiveManikins).mockRejectedValueOnce(new Error("offline"));
    render(<ActiveSessionsPage onViewLive={vi.fn()} onNavigateHome={vi.fn()} />);
    expect(await screen.findByText(/No live sessions right now/)).toBeInTheDocument();
  });

  it("loads recent sessions with sync state, search, selection, and retry", async () => {
    const onSelectSession = vi.fn();

    render(<RecentSessionsPage onSelectSession={onSelectSession} />);

    expect(await screen.findAllByText("trainee-1")).not.toHaveLength(0);
    expect(screen.getAllByText("Pending sync").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Review details" })[0]);
    expect(onSelectSession).toHaveBeenCalledWith("session-1");

    fireEvent.change(screen.getByPlaceholderText("Search by trainee identifier or course..."), {
      target: { value: "missing" },
    });
    expect(screen.getByText("No training sessions found.")).toBeInTheDocument();

    vi.mocked(fetchCompletedSessions).mockRejectedValueOnce(new Error("down"));
    const { unmount } = render(<RecentSessionsPage onSelectSession={vi.fn()} />);
    expect(await screen.findByText("Failed to retrieve completed session history.")).toBeInTheDocument();
    vi.mocked(fetchCompletedSessions).mockResolvedValueOnce([completedSession as any]);
    fireEvent.click(screen.getByText("Retry Load"));
    await waitFor(() => expect(screen.getAllByText("trainee-1").length).toBeGreaterThan(0));
    unmount();
  });

  it("renders session review, instructor exports, trainee restrictions, and load errors", async () => {
    const onBack = vi.fn();
    const { unmount } = render(<SessionReviewPage sessionId="session-1" onBack={onBack} />);

    expect(await screen.findByText("Training Session Review")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Export CSV Session Report"));
    fireEvent.click(screen.getByText("Export JSON Session Report"));
    expect(downloadSessionCsv).toHaveBeenCalledWith("session-1");
    expect(downloadSessionJson).toHaveBeenCalledWith("session-1");
    fireEvent.click(screen.getByText("Back to History"));
    expect(onBack).toHaveBeenCalled();
    unmount();

    vi.mocked(useAuth).mockReturnValue({
      currentUser: { id: "trainee", username: "trainee", displayName: "Trainee", role: "TRAINEE" },
    } as any);
    render(<SessionReviewPage sessionId="session-1" onBack={vi.fn()} />);
    expect(await screen.findByText("Training Session Review")).toBeInTheDocument();
    expect(screen.queryByText("Export CSV Session Report")).not.toBeInTheDocument();
    unmount();

    vi.mocked(fetchAuthoritativeCompletedSession).mockRejectedValueOnce(new Error("missing"));
    render(<SessionReviewPage sessionId="missing" onBack={onBack} />);
    expect(await screen.findByText("Review Unavailable")).toBeInTheDocument();
  });

  it("returns from access denied through callback or window location", () => {
    const onBackToHome = vi.fn();
    render(<AccessDeniedPage onBackToHome={onBackToHome} />);
    fireEvent.click(screen.getByText("Return to Safety"));
    expect(onBackToHome).toHaveBeenCalled();
  });
});
