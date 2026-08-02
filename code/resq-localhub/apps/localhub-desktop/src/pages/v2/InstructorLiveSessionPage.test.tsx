import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import InstructorLiveSessionPage from "./InstructorLiveSessionPage";
import { endSession, fetchAuthoritativeCompletedSession } from "../../api/sessionsApi";
import { useSessionLiveStream } from "../../hooks/useSessionLiveStream";

vi.mock("../../api/sessionsApi", () => ({
  endSession: vi.fn(),
  fetchAuthoritativeCompletedSession: vi.fn(),
}));

vi.mock("../../hooks/useSessionLiveStream", () => ({
  useSessionLiveStream: vi.fn(),
}));

vi.mock("../../components/cpr/LiveCprGraph", () => ({ default: () => <div>graph</div> }));
vi.mock("../../components/cpr/LiveCoachingBanner", () => ({ default: () => <div>coaching</div> }));

const liveSession = {
  sessionId: "S-1",
  deviceId: "M01",
  active: true,
  sessionActive: true,
  lifecycleState: "ACTIVE",
  recoveryStatus: "NONE",
  startedAt: "2026-08-01T10:00:00Z",
  scenario: "Adult CPR",
  connectionState: "CONNECTED",
  latestMetric: null,
};

describe("InstructorLiveSessionPage authoritative completion", () => {
  let terminal: (() => void) | undefined;

  beforeEach(() => {
    terminal = undefined;
    vi.mocked(endSession).mockReset();
    vi.mocked(fetchAuthoritativeCompletedSession).mockReset();
    vi.mocked(useSessionLiveStream).mockImplementation((options) => {
      terminal = () => options.onEnded?.("S-1");
      return {
        session: liveSession as any,
        setSession: vi.fn(),
        loading: false,
        error: null,
      };
    });
  });

  it("shows pending, does not navigate on STOP_PENDING, then navigates after the persisted score is readable", async () => {
    vi.mocked(endSession).mockResolvedValue({
      sessionId: "S-1", deviceId: "M01", requestId: "stop-1",
      state: "STOP_PENDING", active: true, completed: false,
      startedAt: liveSession.startedAt, stopRequestedAt: "2026-08-01T10:00:30Z",
      reason: null, reasonId: null, actionId: null,
    });
    vi.mocked(fetchAuthoritativeCompletedSession).mockResolvedValue({ sessionId: "S-1" } as any);
    const onSessionEnded = vi.fn();
    render(<InstructorLiveSessionPage sessionId="S-1" onSessionEnded={onSessionEnded} />);

    await userEvent.click(screen.getByRole("button", { name: "End Session" }));
    expect(await screen.findByRole("button", { name: "Ending session…" })).toBeDisabled();
    expect(screen.getByText(/Waiting for firmware confirmation/)).toBeInTheDocument();
    expect(onSessionEnded).not.toHaveBeenCalled();

    await act(async () => {
      terminal?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(fetchAuthoritativeCompletedSession).toHaveBeenCalledWith("S-1"));
    await waitFor(() => expect(onSessionEnded).toHaveBeenCalledWith("S-1"));
  });

  it("keeps the page open and reports a bounded summary-read timeout", async () => {
    vi.mocked(fetchAuthoritativeCompletedSession).mockRejectedValue(
      new Error("The session ended, but its final score was not readable within 10 seconds."),
    );
    const onSessionEnded = vi.fn();
    render(<InstructorLiveSessionPage sessionId="S-1" onSessionEnded={onSessionEnded} />);

    await act(async () => {
      terminal?.();
      await Promise.resolve();
    });
    expect(await screen.findByText(/not readable within 10 seconds/)).toBeInTheDocument();
    expect(onSessionEnded).not.toHaveBeenCalled();
  });
});
