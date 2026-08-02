import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import InstructorLiveSessionPage from "./InstructorLiveSessionPage";
import TraineeLiveSessionPage from "./TraineeLiveSessionPage";
import PairManikinPage from "./PairManikinPage";
import {
  fetchSessionLive,
  fetchCompletedSession,
  fetchAuthoritativeCompletedSession,
  endSession,
} from "../../api/sessionsApi";
import { subscribeToSessionLive } from "../../api/liveEventsClient";
import { useAuth } from "../../auth/AuthContext";
import { fetchHubServiceInfo } from "../../lib/browserManikinsProvisionApi";

vi.mock("../../api/sessionsApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/sessionsApi")>();
  return {
    ...actual,
    fetchSessionLive: vi.fn(),
    fetchCompletedSession: vi.fn(),
    fetchAuthoritativeCompletedSession: vi.fn(),
    endSession: vi.fn(),
  };
});

vi.mock("../../api/liveEventsClient", () => ({
  subscribeToSessionLive: vi.fn(),
}));

vi.mock("../../auth/AuthContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../lib/browserManikinsProvisionApi", () => ({
  fetchHubServiceInfo: vi.fn(),
}));

vi.mock("qrcode.react", () => ({
  QRCodeSVG: ({ value }: { value: string }) => <div data-testid="qr-code">{value}</div>,
}));

vi.mock("../../components/cpr/MetricCard", () => ({
  MetricCard: ({ label, value, status }: any) => (
    <article>
      <h4>{label}</h4>
      <span>{value}</span>
      <span>{status}</span>
    </article>
  ),
}));

vi.mock("../../components/cpr/SessionTimer", () => ({
  SessionTimer: ({ active }: any) => <span>{active ? "Timer running" : "Timer stopped"}</span>,
}));

vi.mock("../../components/cpr/LiveCprGraph", () => ({
  default: () => <div>Live graph</div>,
}));

vi.mock("../../components/cpr/LiveCoachingBanner", () => ({
  default: ({ coachingCue }: any) => <div>Coaching: {coachingCue}</div>,
}));

const liveSession = {
  sessionId: "session-1",
  deviceId: "manikin-1",
  manikinId: "manikin-1",
  traineeId: "trainee-1",
  active: true,
  startedAt: "2026-07-28T08:00:00Z",
  profileId: "adult-basic",
  scenario: "Adult CPR",
  notes: null,
  lastSeen: "2026-07-28T08:01:00Z",
  state: "READY_FOR_SESSION",
  online: true,
  ip: null,
  fw: null,
  rssi: null,
  battery: null,
  sessionActive: true,
  latestDepthMm: 55,
  latestRateCpm: 110,
  latestRecoilOk: true,
  latestPauseS: null,
  latestFlags: "DEPTH_OK,RATE_OK,RECOIL_OK",
  lastEventType: "metric",
  latestForce1: null,
  latestForce2: null,
  pressureBalancePct: 52,
  pressureSkewed: false,
  latestMetric: {
    compressionCount: 24,
    depthMm: 55,
    rateCpm: 110,
    recoilOk: true,
    flags: "DEPTH_OK,RATE_OK,RECOIL_OK",
  },
  seq: 3,
  connectionState: "ONLINE",
  stale: false,
  offline: false,
  lifecycleState: "ACTIVE",
  requestId: null,
  recoveryStatus: "NONE",
  recoveryReason: null,
};

const completedSession = {
  sessionId: "session-1",
  traineeId: "trainee-1",
  courseId: "course-1",
  scenario: "Adult CPR",
  startedAt: "2026-07-28T08:00:00Z",
  endedAt: "2026-07-28T08:02:00Z",
  notes: null,
  summary: {
    score: 88,
    durationSeconds: 120,
    totalCompressions: 60,
    validCompressions: 54,
    avgDepthMm: 55,
    avgDepthProgress: 0.84,
    avgRateCpm: 110,
    recoilPct: 94,
    pausesCount: 0,
    scoringVersion: "moderate-v1",
    overallScore: 88,
    grade: "Good",
    depthScore: 88,
    rateScore: 88,
    recoilScore: 88,
    handPlacementScore: 88,
    compressionFractionScore: 88,
    scoreProvisional: false,
  },
};

const sessionLiveHandlers: Array<{
  onUpdate: (view: any) => void;
  onEnded: () => void;
  onError: (error: unknown) => void;
  stop: ReturnType<typeof vi.fn>;
}> = [];

beforeEach(() => {
  vi.useRealTimers();
  sessionLiveHandlers.length = 0;
  vi.mocked(fetchSessionLive).mockResolvedValue(liveSession as any);
  vi.mocked(fetchCompletedSession).mockResolvedValue(completedSession as any);
  vi.mocked(fetchAuthoritativeCompletedSession).mockResolvedValue(completedSession as any);
  vi.mocked(endSession).mockResolvedValue({
    active: true,
    state: "STOP_PENDING",
    requestId: "stop-1",
  } as any);
  vi.mocked(subscribeToSessionLive).mockImplementation((_sessionId, _deviceId, onUpdate, onEnded, onError) => {
    const handler = { onUpdate, onEnded, onError, stop: vi.fn() };
    sessionLiveHandlers.push(handler);
    return { stop: handler.stop };
  });
  vi.mocked(useAuth).mockReturnValue({
    currentUser: { id: "trainee-1", username: "sam", displayName: "Sam Trainee", role: "TRAINEE" },
    logout: vi.fn().mockResolvedValue(undefined),
  } as any);
  vi.mocked(fetchHubServiceInfo).mockResolvedValue({ local_ip: "192.168.8.5" } as any);
  vi.stubGlobal("alert", vi.fn());
  vi.stubGlobal("open", vi.fn());
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe("live session and manikin pairing pages", () => {
  it("loads instructor live telemetry, sends a stop request, and reacts to stream completion", async () => {
    const onSessionEnded = vi.fn();

    render(<InstructorLiveSessionPage sessionId="session-1" onSessionEnded={onSessionEnded} />);

    expect(screen.getByText("Connecting to training session...")).toBeInTheDocument();
    expect(await screen.findByText("Live CPR Training")).toBeInTheDocument();
    expect(screen.getByText("Device: manikin-1")).toBeInTheDocument();
    expect(screen.getByText("Coaching: Active")).toBeInTheDocument();

    fireEvent.click(screen.getByText("End Session"));
    await waitFor(() => expect(endSession).toHaveBeenCalledWith({ sessionId: "session-1" }));
    expect(screen.getByText("Stopping session. Waiting for firmware confirmation.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ending session…" })).toBeDisabled();

    act(() => {
      sessionLiveHandlers[0].onUpdate({
        ...liveSession,
        lifecycleState: "COMPLETED",
        active: false,
        sessionActive: false,
      });
      sessionLiveHandlers[0].onEnded();
    });

    expect(await screen.findByText("Session completed. Loading final score…")).toBeInTheDocument();
    await waitFor(() => expect(onSessionEnded).toHaveBeenCalledWith("session-1"));
  });

  it("shows instructor unavailable state and routes back through the supplied callback", async () => {
    vi.mocked(fetchSessionLive).mockResolvedValueOnce(null);
    const onSessionEnded = vi.fn();

    render(<InstructorLiveSessionPage sessionId="missing-session" onSessionEnded={onSessionEnded} />);

    expect(await screen.findByText("Session Unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Return to Dashboard"));
    expect(onSessionEnded).toHaveBeenCalledWith("missing-session");
  });

  it("loads trainee live practice and swaps to the completed summary when the stream ends", async () => {
    const onSessionEnded = vi.fn();

    render(<TraineeLiveSessionPage sessionId="session-1" onSessionEnded={onSessionEnded} />);

    expect(screen.getByText("Connecting to training session monitor...")).toBeInTheDocument();
    expect(await screen.findByText("ResQ Live Practice")).toBeInTheDocument();
    expect(screen.getByText(/Signed in as/)).toBeInTheDocument();
    expect(screen.getByText("Coaching: Active")).toBeInTheDocument();

    act(() => {
      sessionLiveHandlers[0].onEnded();
    });

    expect(await screen.findByText("Session completed")).toBeInTheDocument();
    expect(screen.getByText("88%")).toBeInTheDocument();
    expect(fetchAuthoritativeCompletedSession).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(onSessionEnded).not.toHaveBeenCalled();
  });

  it("renders trainee closed state when no active session exists", async () => {
    vi.mocked(fetchSessionLive).mockResolvedValueOnce(null);

    render(<TraineeLiveSessionPage sessionId="missing-session" onSessionEnded={vi.fn()} />);

    expect(await screen.findByText("Session Closed")).toBeInTheDocument();
    expect(
      screen.getByText("The requested live session was not found or has already ended."),
    ).toBeInTheDocument();
  });

  it("builds, copies, opens, clears, and completes a manikin provisioning QR", async () => {
    const onBack = vi.fn();

    render(<PairManikinPage onBack={onBack} />);

    fireEvent.click(screen.getByText("Advanced Network Settings"));
    expect(await screen.findByDisplayValue("http://192.168.8.5:18080")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Training Wi-Fi name"), { target: { value: "LabNet" } });
    fireEvent.change(screen.getByLabelText("Training Wi-Fi password"), { target: { value: "train-pass" } });
    fireEvent.click(screen.getByText("Generate setup QR"));

    expect(await screen.findByText("Setup QR Code Generated")).toBeInTheDocument();
    const qrValue = screen.getByTestId("qr-code").textContent ?? "";
    expect(qrValue).toContain("LabNet");
    expect(qrValue).toContain("train-pass");
    expect(qrValue).toContain("192.168.8.5");

    fireEvent.click(screen.getByText("Copy Link"));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(qrValue));
    expect(alert).toHaveBeenCalledWith("Provisioning link copied to clipboard.");

    fireEvent.click(screen.getByText("Open Setup Link"));
    expect(open).toHaveBeenCalledWith(qrValue, "_blank");

    fireEvent.click(screen.getByText("Clear Details"));
    expect(screen.getByLabelText("Training Wi-Fi name")).toHaveValue("");

    fireEvent.click(screen.getByText("Cancel"));
    expect(onBack).toHaveBeenCalled();
  });

  it("validates required pairing fields before generating a QR", async () => {
    vi.mocked(fetchHubServiceInfo).mockResolvedValueOnce({ local_ip: "localhost" } as any);
    render(<PairManikinPage onBack={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Training Wi-Fi name"), { target: { value: "LabNet" } });
    fireEvent.change(screen.getByLabelText("Training Wi-Fi password"), { target: { value: "train-pass" } });
    fireEvent.click(screen.getByText("Generate setup QR"));
    expect(await screen.findByText("LocalHub address is required.")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Advanced Network Settings"));
    fireEvent.change(screen.getByLabelText("LocalHub address"), { target: { value: "192.168.8.5:18080" } });
    fireEvent.click(screen.getByText("Generate setup QR"));
    expect(screen.getByText("LocalHub address must start with 'http://' or 'https://'.")).toBeInTheDocument();
  });
});
