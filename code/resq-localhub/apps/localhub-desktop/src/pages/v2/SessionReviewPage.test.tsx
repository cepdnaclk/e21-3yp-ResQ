import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SessionReviewPage from "./SessionReviewPage";
import { fetchAuthoritativeCompletedSession } from "../../api/sessionsApi";
import type { CompletedSession } from "../../types/session";

vi.mock("../../api/sessionsApi", () => ({
  fetchAuthoritativeCompletedSession: vi.fn(),
}));

vi.mock("../../api/exportsApi", () => ({
  downloadSessionJson: vi.fn(),
  downloadSessionCsv: vi.fn(),
}));

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ currentUser: { role: "INSTRUCTOR" } }),
}));

function completed(overrides: Record<string, unknown> = {}): CompletedSession {
  return {
    sessionId: "S-1",
    deviceId: "M01",
    traineeId: "T01",
    startedAt: "2026-08-01T10:00:00Z",
    ended: true,
    endedAt: "2026-08-01T10:01:00Z",
    scenario: "Adult CPR",
    notes: null,
    summary: {
      sessionId: "S-1", deviceId: "M01", traineeId: "T01",
      startedAt: "2026-08-01T10:00:00Z", endedAt: "2026-08-01T10:01:00Z",
      durationSeconds: 60, sampleCount: 20, totalCompressions: 12, validCompressions: 12,
      avgDepthMm: 54, avgDepthProgress: 0.9, avgRateCpm: 110, recoilPct: 95,
      recoilOkCount: 11, incompleteRecoilCount: 1, pausesCount: 0, score: 0, latestFlags: null,
      scoringVersion: "moderate-v1", overallScore: 0, grade: "Needs practice",
      depthScore: 0, rateScore: 0, recoilScore: 0, handPlacementScore: 0,
      compressionFractionScore: 0, scoreProvisional: true, scoreValidCompressionCount: 12,
      handPlacementPct: 90, compressionFractionPct: 88,
      ...overrides,
    },
  };
}

describe("SessionReviewPage final scoring", () => {
  beforeEach(() => {
    vi.mocked(fetchAuthoritativeCompletedSession).mockReset();
  });

  it("shows a valid zero score, every component, version, and provisional state", async () => {
    vi.mocked(fetchAuthoritativeCompletedSession).mockResolvedValue(completed());
    render(<SessionReviewPage sessionId="S-1" onBack={vi.fn()} />);

    expect(await screen.findByText("0%")).toBeInTheDocument();
    expect(screen.getByText(/Needs practice · Provisional/)).toBeInTheDocument();
    expect(screen.getByText("moderate-v1")).toBeInTheDocument();
    expect(screen.getByText("Depth")).toBeInTheDocument();
    expect(screen.getByText("Rate")).toBeInTheDocument();
    expect(screen.getByText("Recoil")).toBeInTheDocument();
    expect(screen.getByText("Hand placement")).toBeInTheDocument();
    expect(screen.getByText("Compression fraction")).toBeInTheDocument();
    expect(screen.getAllByText("0/100")).toHaveLength(5);
    expect(fetchAuthoritativeCompletedSession).toHaveBeenCalledWith("S-1", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("shows the specific unavailable reason instead of an empty score", async () => {
    vi.mocked(fetchAuthoritativeCompletedSession).mockResolvedValue(completed({
      overallScore: null,
      grade: "Unavailable",
      depthScore: null,
      rateScore: null,
      recoilScore: null,
      handPlacementScore: null,
      compressionFractionScore: null,
      scoreCapReason: "required hand-placement evidence is unavailable",
    }));
    render(<SessionReviewPage sessionId="S-1" onBack={vi.fn()} />);

    expect(await screen.findAllByText(/Score unavailable: required hand-placement evidence is unavailable/)).toHaveLength(2);
    expect(screen.getByText("Unavailable · Provisional")).toBeInTheDocument();
  });

  it("renders an actionable bounded-read error", async () => {
    let rejectRead: ((reason: Error) => void) | null = null;
    vi.mocked(fetchAuthoritativeCompletedSession).mockImplementation(() => new Promise((_, reject) => {
      rejectRead = reject;
    }));
    render(<SessionReviewPage sessionId="S-1" onBack={vi.fn()} />);
    await waitFor(() => expect(rejectRead).not.toBeNull());
    rejectRead!(new Error("The session ended, but its final score was not readable within 10 seconds."));
    expect(await screen.findByText(/not readable within 10 seconds/)).toBeInTheDocument();
  });
});
