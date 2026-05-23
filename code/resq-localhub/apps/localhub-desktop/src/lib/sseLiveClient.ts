import { isLiveUpdateForSelection, toLiveClientUpdate, type LiveClientUpdate } from "./liveClientTypes";

export type SseLiveClientOptions = {
  deviceId: string;
  sessionId?: string | null;
  backendBaseUrl: string;
};

export type SseLiveClientCallbacks = {
  onOpen(): void;
  onUpdate(update: LiveClientUpdate): void;
  onError(error: Error): void;
};

export type SseLiveClient = {
  start(): void;
  stop(): void;
};

export function createSseLiveClient(options: SseLiveClientOptions, callbacks: SseLiveClientCallbacks): SseLiveClient {
  let eventSource: EventSource | null = null;
  let stopped = false;

  function start(): void {
    stopped = false;
    if (typeof window === "undefined" || typeof window.EventSource === "undefined") {
      callbacks.onError(new Error("Browser EventSource is not available"));
      return;
    }

    eventSource = new EventSource(getSseUrl(options), { withCredentials: true });
    eventSource.onopen = () => {
      if (!stopped) {
        callbacks.onOpen();
      }
    };
    eventSource.onerror = () => {
      if (!stopped) {
        callbacks.onError(new Error("Backend SSE stream failed"));
      }
    };
    eventSource.addEventListener("session-live", handleMessage);
    eventSource.addEventListener("manikins-live", handleMessage);
  }

  function stop(): void {
    stopped = true;
    if (eventSource) {
      eventSource.removeEventListener("session-live", handleMessage);
      eventSource.removeEventListener("manikins-live", handleMessage);
      eventSource.close();
      eventSource = null;
    }
  }

  function handleMessage(event: MessageEvent<string>): void {
    const updates = parseSsePayload(event.data);
    for (const update of updates) {
      if (isLiveUpdateForSelection(update, options.deviceId, options.sessionId)) {
        callbacks.onUpdate(update);
      }
    }
  }

  return { start, stop };
}

function getSseUrl(options: SseLiveClientOptions): string {
  if (options.sessionId) {
    return `${options.backendBaseUrl}/api/stream/sessions/live/${encodeURIComponent(options.sessionId)}`;
  }

  return `${options.backendBaseUrl}/api/stream/manikins/live`;
}

function parseSsePayload(raw: string): LiveClientUpdate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const values = Array.isArray(parsed) ? parsed : [parsed];
  return values.flatMap((value) => {
    const update = toLiveClientUpdate(value);
    return update ? [update] : [];
  });
}
