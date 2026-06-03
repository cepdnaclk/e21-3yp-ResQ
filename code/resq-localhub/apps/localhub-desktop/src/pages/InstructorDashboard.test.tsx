import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
// Suppress specific undici/WebSocket Event realm errors in the test environment
process.on?.("uncaughtException", (err: unknown) => {
  try {
    const e = err as Error & { code?: string };
    if (e?.code === "ERR_INVALID_ARG_TYPE" && e.message.includes("The \"event\" argument must be an instance of Event")) {
      return;
    }
  } catch {}
  throw err as any;
});
process.on?.("unhandledRejection", (reason) => {
  try {
    const e = reason as Error & { message?: string };
    if (e?.message && e.message.includes("The \"event\" argument must be an instance of Event")) {
      return;
    }
  } catch {}
  // allow other rejections to bubble
});
import InstructorDashboard from "./InstructorDashboard";
import { AuthProvider } from "../auth/AuthContext";
import * as authApi from "../lib/authApi";
import { fetchBrowserHealth } from "../lib/browserHealthApi";
import { fetchLiveManikins, getLiveManikinsStreamUrl } from "../lib/browserManikinsApi";
import {
  endSession,
  fetchCompletedSession,
  fetchCompletedSessions,
  startSession,
} from "../lib/browserSessionsApi";

vi.mock("../lib/browserHealthApi", () => ({
  fetchBrowserHealth: vi.fn(),
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
    vi.spyOn(authApi, "fetchAuthStatus").mockResolvedValue({ hasUsers: true, requiresFirstAdmin: false });
    vi.spyOn(authApi, "fetchCurrentUser").mockResolvedValue({ id: "test-user", displayName: "Test User", role: "ADMIN" } as any);
    // Default to no EventSource to avoid WebSocket/undici noise in tests;
    // individual tests can enable a MockEventSource if needed.
    setEventSource(undefined);

    vi.mocked(fetchBrowserHealth).mockResolvedValue({
      ok: true,
      service: "hub-api",
      timestamp: new Date().toISOString(),
    });

    vi.mocked(fetchLiveManikins).mockResolvedValue([]);
    vi.mocked(fetchCompletedSessions).mockResolvedValue([]);
    vi.mocked(fetchCompletedSession).mockResolvedValue(null as never);
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
    render(
      <AuthProvider>
        <InstructorDashboard embeddedInDesktop />
      </AuthProvider>
    );

    expect(await screen.findByText("Healthy")).toBeInTheDocument();
  });

  it("shows stream unavailable when EventSource is not available", async () => {
    setEventSource(undefined);

    render(
      <AuthProvider>
        <InstructorDashboard embeddedInDesktop />
      </AuthProvider>
    );

    expect(await screen.findByText("Stream unavailable")).toBeInTheDocument();
    expect(getLiveManikinsStreamUrl).not.toHaveBeenCalled();
  });

  it("starts a session for a manikin", async () => {
    vi.mocked(fetchLiveManikins).mockResolvedValue([{ ...baseManikin }]);

    render(
      <AuthProvider>
        <InstructorDashboard embeddedInDesktop />
      </AuthProvider>
    );

    expect(await screen.findByRole("heading", { name: "MAN-01" })).toBeInTheDocument();

    // Use Guest mode so we don't need trainee selection in tests
    await userEvent.click(screen.getByRole("button", { name: "Guest" }));
    await userEvent.click(screen.getByRole("button", { name: "Start Session" }));

    await waitFor(() => {
      expect(startSession).toHaveBeenCalledWith({
        deviceId: "MAN-01",
        guestLabel: "Guest Trainee",
        scenario: null,
        notes: null,
      });
    });

    expect(await screen.findByText(/Started session sess-001/i)).toBeInTheDocument();
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

    render(
      <AuthProvider>
        <InstructorDashboard embeddedInDesktop />
      </AuthProvider>
    );

    const endButton = await screen.findByRole("button", { name: "End Session" });
    await userEvent.click(endButton);

    await waitFor(() => {
      expect(endSession).toHaveBeenCalledWith({ sessionId: "sess-active-1" });
    });

    expect(await screen.findByText(/Ended session sess-active-1/i)).toBeInTheDocument();
  });
});
