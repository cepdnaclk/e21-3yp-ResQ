import { render, screen, within } from "@testing-library/react";
import { LiveMetricsPanel } from "./LiveMetricsPanel";
import type { LiveClientState } from "../lib/liveClient";

describe("LiveMetricsPanel", () => {
  it("waits for current-session telemetry instead of showing a stale device snapshot", () => {
    const state: LiveClientState = {
      deviceId: "M-DEV",
      sessionId: "session-2",
      latestMetric: null,
      lastSeenAt: null,
      connectionState: "BACKEND_SSE_FALLBACK",
      sourceMode: "BACKEND_SSE",
      stale: false,
      offline: false,
      message: null,
      lastHeartbeatAt: null,
      lastStatusAt: null,
      lastEventType: null,
      firmwareState: "SESSION_ACTIVE",
      calibrated: true,
      sessionActive: true,
      lastErrorId: null,
      eventId: null,
      reasonId: null,
      actionId: null,
      progressId: null,
      error: null,
    };

    render(<LiveMetricsPanel state={state} />);

    expect(screen.getByRole("status")).toHaveTextContent("Waiting for CPR telemetry...");
  });

  it("renders normalized session metrics received from SSE", () => {
    const state: LiveClientState = {
      deviceId: "M-DEV",
      sessionId: "session-1",
      latestMetric: {
        deviceId: "M-DEV",
        sessionId: "session-1",
        depthMm: null,
        depthProgress: 1,
        depthOk: true,
        rateCpm: 0,
        recoilOk: null,
        pauseS: 3.08,
        compressionCount: 11,
        validCompressionCount: 10,
        recoilOkCount: 8,
        incompleteRecoilCount: 1,
        handPlacement: "CENTER",
        pressureBalancePct: 91,
        flags: "DEPTH_OK,INCOMPLETE_RECOIL,HAND_CENTERED",
      },
      lastSeenAt: "2026-06-12T00:00:00Z",
      connectionState: "BACKEND_SSE_FALLBACK",
      sourceMode: "BACKEND_SSE",
      stale: false,
      offline: false,
      message: null,
      lastHeartbeatAt: null,
      lastStatusAt: null,
      lastEventType: null,
      firmwareState: "SESSION_ACTIVE",
      calibrated: true,
      sessionActive: true,
      lastErrorId: null,
      eventId: null,
      reasonId: null,
      actionId: null,
      progressId: null,
      error: null,
    };

    const { rerender } = render(<LiveMetricsPanel state={state} />);

    expect(within(screen.getByRole("group", { name: "Depth" })).getByText("100%")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Depth OK" })).getByText("OK")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Compressions" })).getByText("11")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Valid Compressions" })).getByText("10")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Recoil OK Count" })).getByText("8")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Incomplete Recoil" })).getByText("1")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Pressure Balance" })).getByText("91%")).toBeInTheDocument();

    rerender(
      <LiveMetricsPanel
        state={{
          ...state,
          latestMetric: {
            ...state.latestMetric!,
            pressureBalancePct: 19,
            tsMs: 260971,
          },
        }}
      />,
    );

    expect(within(screen.getByRole("group", { name: "Pressure Balance" })).getByText("19%")).toBeInTheDocument();
  });
});
