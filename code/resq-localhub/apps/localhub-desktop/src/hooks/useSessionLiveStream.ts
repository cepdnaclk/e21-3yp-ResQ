import { useEffect, useRef, useState } from "react";
import { subscribeToSessionLive } from "../api/liveEventsClient";
import { fetchSessionLive } from "../api/sessionsApi";
import type { SessionLiveView } from "../types/live";

type EndBehavior = "notify" | "mark-inactive";

type UseSessionLiveStreamOptions = {
  sessionId: string;
  onEnded?: (sessionId: string) => void;
  endBehavior?: EndBehavior;
  stopOnInactiveUpdate?: boolean;
};

type LiveStreamState = {
  session: SessionLiveView | null;
  setSession: React.Dispatch<React.SetStateAction<SessionLiveView | null>>;
  loading: boolean;
  error: string | null;
};

function requestFrame(callback: FrameRequestCallback): number {
  if (typeof window.requestAnimationFrame === "function") {
    return window.requestAnimationFrame(callback);
  }
  return window.setTimeout(() => callback(performance.now()), 16);
}

function cancelFrame(frameId: number) {
  if (typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(frameId);
  } else {
    window.clearTimeout(frameId);
  }
}

/**
 * Owns exactly one session subscription and applies only the newest payload
 * once per browser frame. This keeps SSE ingestion independent from React's
 * rendering pace while retaining the complete authoritative payload.
 */
export function useSessionLiveStream({
  sessionId,
  onEnded,
  endBehavior = "notify",
  stopOnInactiveUpdate = false,
}: UseSessionLiveStreamOptions): LiveStreamState {
  const [session, setSession] = useState<SessionLiveView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const onEndedRef = useRef(onEnded);

  onEndedRef.current = onEnded;

  useEffect(() => {
    let disposed = false;
    let subscription: { stop: () => void } | null = null;
    let frameId: number | null = null;
    let pending: SessionLiveView | null = null;

    setSession(null);
    setLoading(true);
    setError(null);

    const flushPending = () => {
      frameId = null;
      if (disposed || !pending) {
        return;
      }
      const next = pending;
      pending = null;
      setSession(next);
    };

    const enqueueLatest = (next: SessionLiveView) => {
      pending = next;
      if (frameId === null) {
        frameId = requestFrame(flushPending);
      }
    };

    const markInactive = () => {
      const next = pending;
      if (next) {
        enqueueLatest({ ...next, active: false, sessionActive: false });
      } else {
        setSession((current) =>
          current ? { ...current, active: false, sessionActive: false } : current,
        );
      }
    };

    async function initialize() {
      try {
        const initial = await fetchSessionLive(sessionId);
        if (disposed) {
          return;
        }
        if (!initial) {
          setError("The requested live session was not found or has already ended.");
          setLoading(false);
          return;
        }

        setSession(initial);
        setLoading(false);
        subscription = subscribeToSessionLive(
          sessionId,
          initial.deviceId,
          (update) => {
            if (disposed) {
              return;
            }
            enqueueLatest(update);
            if (
              stopOnInactiveUpdate &&
              (update.active === false || update.sessionActive === false)
            ) {
              subscription?.stop();
            }
          },
          () => {
            if (disposed) {
              return;
            }
            if (endBehavior === "mark-inactive") {
              markInactive();
            } else {
              onEndedRef.current?.(sessionId);
            }
            subscription?.stop();
          },
          () => {
            // EventSource reconnects automatically. Preserve the last valid
            // snapshot instead of replacing live metrics with an error state.
          },
        );
      } catch {
        if (!disposed) {
          setError("Failed to connect to the live session stream.");
          setLoading(false);
        }
      }
    }

    void initialize();

    return () => {
      disposed = true;
      pending = null;
      if (frameId !== null) {
        cancelFrame(frameId);
      }
      subscription?.stop();
    };
  }, [endBehavior, sessionId, stopOnInactiveUpdate]);

  return { session, setSession, loading, error };
}
