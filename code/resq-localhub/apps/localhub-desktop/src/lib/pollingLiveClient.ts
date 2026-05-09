import { isLiveUpdateForSelection, toLiveClientUpdate, type LiveClientUpdate } from "./liveClientTypes";

export type PollingLiveClientOptions = {
  deviceId: string;
  sessionId?: string | null;
  backendBaseUrl: string;
  intervalMs: number;
};

export type PollingLiveClientCallbacks = {
  onUpdate(update: LiveClientUpdate): void;
  onError(error: Error): void;
};

export type PollingLiveClient = {
  start(): void;
  stop(): void;
};

export function createPollingLiveClient(
  options: PollingLiveClientOptions,
  callbacks: PollingLiveClientCallbacks,
): PollingLiveClient {
  let stopped = false;
  let timer: number | null = null;
  let inFlight = false;

  function start(): void {
    stopped = false;
    void poll();
    timer = window.setInterval(() => {
      void poll();
    }, Math.max(500, options.intervalMs));
  }

  function stop(): void {
    stopped = true;
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  async function poll(): Promise<void> {
    if (stopped || inFlight) {
      return;
    }

    inFlight = true;
    try {
      const response = await fetch(getPollingUrl(options), {
        credentials: "include",
      });
      if (response.status === 404) {
        callbacks.onError(new Error("Live snapshot was not found"));
        return;
      }
      if (!response.ok) {
        callbacks.onError(new Error(`Live polling failed (${response.status})`));
        return;
      }

      const parsed: unknown = await response.json();
      const update = toLiveClientUpdate(parsed);
      if (update && isLiveUpdateForSelection(update, options.deviceId, options.sessionId)) {
        callbacks.onUpdate(update);
      }
    } catch (error) {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      inFlight = false;
    }
  }

  return { start, stop };
}

function getPollingUrl(options: PollingLiveClientOptions): string {
  if (options.sessionId) {
    return `${options.backendBaseUrl}/api/sessions/live/${encodeURIComponent(options.sessionId)}`;
  }

  return `${options.backendBaseUrl}/api/manikins/live/${encodeURIComponent(options.deviceId)}`;
}
