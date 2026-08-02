import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TraineeLiveSessionPage from "./TraineeLiveSessionPage";
import { fetchAuthoritativeCompletedSession } from "../../api/sessionsApi";
import { useSessionLiveStream } from "../../hooks/useSessionLiveStream";

vi.mock("../../api/sessionsApi", () => ({ fetchAuthoritativeCompletedSession: vi.fn() }));
vi.mock("../../hooks/useSessionLiveStream", () => ({ useSessionLiveStream: vi.fn() }));
vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ currentUser: { displayName: "Trainee" }, logout: vi.fn() }),
}));
vi.mock("../../components/cpr/LiveCprGraph", () => ({ default: () => <div>graph</div> }));
vi.mock("../../components/cpr/LiveCoachingBanner", () => ({ default: () => <div>coaching</div> }));

const baseSession = {
  sessionId: "S-1", deviceId: "M01", active: false, sessionActive: false,
  lifecycleState: "STOP_PENDING", recoveryStatus: "NONE",
  startedAt: "2026-08-01T10:00:00Z", scenario: "Adult CPR",
  connectionState: "CONNECTED", latestMetric: null,
};

const completed = {
  sessionId: "S-1", deviceId: "M01", traineeId: "T01",
  startedAt: "2026-08-01T10:00:00Z", ended: true,
  endedAt: "2026-08-01T10:01:00Z", scenario: "Adult CPR", notes: null,
  summary: {
    sessionId: "S-1", deviceId: "M01", traineeId: "T01",
    startedAt: "2026-08-01T10:00:00Z", endedAt: "2026-08-01T10:01:00Z",
    durationSeconds: 60, sampleCount: 20, totalCompressions: 12, validCompressions: 12,
    avgDepthMm: 54, avgDepthProgress: 0.9, avgRateCpm: 110, recoilPct: 95,
    recoilOkCount: 11, incompleteRecoilCount: 1, pausesCount: 0, score: 0, latestFlags: null,
    scoringVersion: "moderate-v1", overallScore: 0, grade: "Needs practice",
    depthScore: 0, rateScore: 0, recoilScore: 0, handPlacementScore: 0,
    compressionFractionScore: 0, scoreProvisional: true,
  },
};

describe("TraineeLiveSessionPage completion", () => {
  beforeEach(() => {
    vi.mocked(fetchAuthoritativeCompletedSession).mockReset();
    vi.mocked(useSessionLiveStream).mockReturnValue({
      session: baseSession as any, setSession: vi.fn(), loading: false, error: null,
    });
  });

  it("loads the authoritative result and displays zero plus all component scores", async () => {
    vi.mocked(fetchAuthoritativeCompletedSession).mockResolvedValue(completed as any);
    render(<TraineeLiveSessionPage sessionId="S-1" onSessionEnded={vi.fn()} />);

    expect(await screen.findByText("0%")).toBeInTheDocument();
    expect(screen.getByText("Needs practice · Provisional")).toBeInTheDocument();
    expect(screen.getByText(/Scoring version: moderate-v1/)).toBeInTheDocument();
    expect(screen.getByText("Depth score")).toBeInTheDocument();
    expect(screen.getByText("Rate score")).toBeInTheDocument();
    expect(screen.getByText("Recoil score")).toBeInTheDocument();
    expect(screen.getByText("Hand-placement score")).toBeInTheDocument();
    expect(screen.getByText("Compression-fraction score")).toBeInTheDocument();
    expect(screen.getAllByText("0/100")).toHaveLength(5);
  });

  it("shows an explicit interrupted result without inventing a final score", async () => {
    vi.mocked(useSessionLiveStream).mockReturnValue({
      session: { ...baseSession, lifecycleState: "INTERRUPTED" } as any,
      setSession: vi.fn(), loading: false, error: null,
    });
    render(<TraineeLiveSessionPage sessionId="S-1" onSessionEnded={vi.fn()} />);

    expect(await screen.findByText(/Session interrupted by the device/)).toBeInTheDocument();
    expect(fetchAuthoritativeCompletedSession).not.toHaveBeenCalled();
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
  });
});
