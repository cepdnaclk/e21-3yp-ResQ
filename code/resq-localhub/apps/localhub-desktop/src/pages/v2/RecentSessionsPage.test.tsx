import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecentSessionsPage } from "./RecentSessionsPage";

const fetchCompletedSessions = vi.fn();
const fetchSyncQueue = vi.fn();

vi.mock("../../api/sessionsApi", () => ({
  fetchCompletedSessions: () => fetchCompletedSessions(),
  fetchSyncQueue: () => fetchSyncQueue(),
}));

describe("RecentSessionsPage responsive actions", () => {
  beforeEach(() => {
    fetchCompletedSessions.mockResolvedValue([
      {
        sessionId: "session-responsive",
        deviceId: "M01",
        traineeId: "trainee-responsive",
        courseId: "course-responsive",
        instructorId: "instructor-responsive",
        startedAt: "2026-08-02T12:00:00Z",
        ended: true,
        endedAt: "2026-08-02T12:01:00Z",
        scenario: "Adult CPR",
        notes: null,
        summary: {
          sessionId: "session-responsive",
          deviceId: "M01",
          traineeId: "trainee-responsive",
          startedAt: "2026-08-02T12:00:00Z",
          endedAt: "2026-08-02T12:01:00Z",
          durationSeconds: 60,
          sampleCount: 300,
          totalCompressions: 108,
          validCompressions: 108,
          avgDepthMm: 54,
          avgDepthProgress: 0.98,
          avgRateCpm: 108,
          recoilPct: 94,
          recoilOkCount: 102,
          incompleteRecoilCount: 6,
          pausesCount: 0,
          score: 91,
          latestFlags: "DEPTH_OK,RATE_OK,RECOIL_OK",
        },
      },
    ]);
    fetchSyncQueue.mockResolvedValue([]);
  });

  it("keeps review actions in responsive cards below 2XL and in the wide table", async () => {
    const onSelectSession = vi.fn();
    render(<RecentSessionsPage onSelectSession={onSelectSession} />);

    const reviewActions = await screen.findAllByRole("button", { name: "Review details" });
    expect(reviewActions).toHaveLength(2);
    expect(reviewActions[0]).toHaveClass("w-full", "sm:w-auto");
    expect(screen.getByRole("table").parentElement?.parentElement).toHaveClass("hidden", "2xl:block");

    fireEvent.click(reviewActions[0]);
    expect(onSelectSession).toHaveBeenCalledOnce();
    expect(onSelectSession).toHaveBeenCalledWith("session-responsive");
  });
});
