import { StrictMode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSessionLive } from "../api/sessionsApi";
import { subscribeToSessionLive } from "../api/liveEventsClient";
import type { SessionLiveView } from "../types/live";
import { useSessionLiveStream } from "./useSessionLiveStream";

vi.mock("../api/sessionsApi", () => ({
  fetchSessionLive: vi.fn(),
}));

vi.mock("../api/liveEventsClient", () => ({
  subscribeToSessionLive: vi.fn(),
}));

function session(seq: number): SessionLiveView {
  return {
    sessionId: "session-1",
    deviceId: "M637",
    active: true,
    sessionActive: true,
    latestMetric: { seq } as SessionLiveView["latestMetric"],
  } as SessionLiveView;
}

describe("useSessionLiveStream", () => {
  let update: (value: SessionLiveView) => void;
  let ended: () => void;
  let stop: ReturnType<typeof vi.fn>;
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    frames = [];
    stop = vi.fn();
    vi.mocked(fetchSessionLive).mockResolvedValue(session(0));
    vi.mocked(subscribeToSessionLive).mockImplementation(
      (_sessionId, _deviceId, onUpdate, onEnded) => {
        update = onUpdate;
        ended = onEnded;
        return { stop };
      },
    );
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  it("keeps one active subscription in StrictMode and cleans it up", async () => {
    const onEnded = vi.fn();
    const { unmount } = renderHook(
      () => useSessionLiveStream({ sessionId: "session-1", onEnded }),
      { wrapper: StrictMode },
    );

    await waitFor(() => expect(subscribeToSessionLive).toHaveBeenCalledTimes(1));
    unmount();

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("coalesces a burst to the newest payload on one animation frame", async () => {
    const { result } = renderHook(() =>
      useSessionLiveStream({ sessionId: "session-1" }),
    );
    await waitFor(() => expect(result.current.session?.latestMetric?.seq).toBe(0));

    act(() => {
      update(session(1));
      update(session(2));
      update(session(3));
    });

    expect(frames).toHaveLength(1);
    expect(result.current.session?.latestMetric?.seq).toBe(0);

    act(() => {
      frames[0](16);
    });
    expect(result.current.session?.latestMetric?.seq).toBe(3);
  });

  it("applies backpressure to a sustained burst without dropping the newest sample", async () => {
    const { result } = renderHook(() =>
      useSessionLiveStream({ sessionId: "session-1" }),
    );
    await waitFor(() => expect(result.current.session).not.toBeNull());

    act(() => {
      for (let seq = 1; seq <= 1_000; seq += 1) {
        update(session(seq));
      }
    });

    expect(frames).toHaveLength(1);
    act(() => frames[0](16));
    expect(result.current.session?.latestMetric?.seq).toBe(1_000);
  });

  it("marks trainee sessions inactive on the terminal event without losing data", async () => {
    const { result } = renderHook(() =>
      useSessionLiveStream({
        sessionId: "session-1",
        endBehavior: "mark-inactive",
      }),
    );
    await waitFor(() => expect(result.current.session).not.toBeNull());

    act(() => ended());

    expect(result.current.session?.active).toBe(false);
    expect(result.current.session?.latestMetric?.seq).toBe(0);
  });
});
