import { render, screen } from "@testing-library/react";
import TraineeDashboard from "./TraineeDashboard";
import { fetchBrowserHealth } from "../lib/browserHealthApi";
import { fetchSessionLive } from "../lib/browserSessionsApi";
import { useLiveSession } from "../hooks/useLiveSession";

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    currentUser: null,
    logout: vi.fn(),
  }),
}));

vi.mock("../lib/browserHealthApi", () => ({
  fetchBrowserHealth: vi.fn(),
}));

vi.mock("../hooks/useLiveSession", () => ({
  useLiveSession: vi.fn(),
}));

vi.mock("../lib/browserSessionsApi", () => ({
  fetchSessionLive: vi.fn(),
  getSessionLiveStreamUrl: vi.fn(() => "http://localhost:18080/api/stream/sessions/live/test"),
}));

vi.mock("recharts", async () => {
  const original = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...original,
    ResponsiveContainer: ({ children }: any) => (
      <div style={{ width: "100%", height: "100%" }}>{children}</div>
    ),
  };
});

describe("TraineeDashboard", () => {
  beforeEach(() => {
    vi.mocked(fetchBrowserHealth).mockResolvedValue({
      ok: true,
      service: "hub-api",
      timestamp: new Date().toISOString(),
    });

    vi.mocked(useLiveSession).mockReturnValue({
      deviceId: null,
      sessionId: null,
      latestMetric: null,
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
    });
  });

  it("shows the waiting session story when no session is assigned", async () => {
    render(<TraineeDashboard embeddedInDesktop />);

    expect(await screen.findByRole("heading", { name: "Ready for the next CPR scenario" })).toBeInTheDocument();
    expect(screen.getByText("Ready for the next CPR scenario")).toBeInTheDocument();
    expect(screen.getByText("Helpful tip")).toBeInTheDocument();
  });

  it("shows live vitals when session is active and telemetry matches backend contract", async () => {
    vi.mocked(fetchSessionLive).mockResolvedValue({
      sessionId: "sess-123",
      deviceId: "M01",
      manikinId: "man-01",
      traineeId: "trainee-1",
      active: true,
      startedAt: new Date().toISOString(),
      scenario: "Adult CPR",
      notes: "",
      lastSeen: new Date().toISOString(),
      state: "SESSION_ACTIVE",
      online: true,
      ip: "127.0.0.1",
      fw: "1.0.0",
      rssi: -50,
      battery: 100,
      sessionActive: true,
      latestDepthMm: 52.5,
      latestRateCpm: 105,
      latestRecoilOk: true,
      latestPauseS: 0,
      latestFlags: "DEPTH_OK,RATE_OK,RECOIL_OK",
      lastEventType: "compression",
      latestForce1: 20,
      latestForce2: 20,
      pressureBalancePct: 98,
      pressureSkewed: false,
      latestMetric: null,
      seq: 1,
      connectionState: "MQTT_WS_LIVE",
      stale: false,
      offline: false,
    } as any);

    vi.mocked(useLiveSession).mockReturnValue({
      deviceId: "M01",
      sessionId: "sess-123",
      latestMetric: {
        deviceId: "M01",
        sessionId: "sess-123",
        seq: 1,
        tsMs: Date.now(),
        depthMm: 52.5,
        depthProgress: 0.875,
        depthOk: true,
        rateCpm: 105,
        recoilOk: true,
        pauseS: 0,
        compressionCount: 10,
        handPlacement: "CENTER",
        flags: "DEPTH_OK,RATE_OK,RECOIL_OK",
        validCompressionCount: 9,
        recoilOkCount: 9,
        incompleteRecoilCount: 1,
        pressureBalancePct: 98,
      } as any,
      connectionState: "MQTT_WS_LIVE",
      sourceMode: "DIRECT_MQTT",
      stale: false,
      offline: false,
      message: null,
      firmwareState: "SESSION_ACTIVE",
      sessionActive: true,
    } as any);

    render(<TraineeDashboard embeddedInDesktop initialSessionId="sess-123" />);

    expect(await screen.findByText("CPR Performance Monitor")).toBeInTheDocument();
    expect(screen.getByText("52.5 mm")).toBeInTheDocument();
    expect(screen.getByText("105.0 cpm")).toBeInTheDocument();
    expect(screen.getByText("OK")).toBeInTheDocument();
    expect(screen.getByText("Balance: 98.0%")).toBeInTheDocument();
  });
});
