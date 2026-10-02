import { isLiveUpdateForSelection, toLiveClientUpdate, type LiveClientUpdate } from "./liveClientTypes";
import { getStoredToken } from "./tokenStore";

export type SseEventParser<T> = (eventName: string | null, payload: string) => T[];
export type SseClientCallbacks<T> = {
  onOpen(): void;
  onMessage(message: T): void;
  onError(error: Error): void;
};

export type SseClient = {
  start(): void;
  stop(): void;
};

export function createSseClient<T>(
  url: string,
  callbacks: SseClientCallbacks<T>,
  parser: SseEventParser<T>,
): SseClient {
  let controller: AbortController | null = null;
  let stopped = true;
  let reconnectTimer: number | null = null;
  let retryDelayMs = 2000;

  function start(): void {
    if (!stopped) return;
    stopped = false;
    void connect();
  }

  async function connect(): Promise<void> {
    if (stopped || controller) return;
    const token = getStoredToken();
    if (!token) {
      stop();
      callbacks.onError(new Error("AUTH_REQUIRED"));
      return;
    }
    const attempt = new AbortController();
    controller = attempt;
    const active = () => !stopped && controller === attempt;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
        cache: "no-store",
        signal: attempt.signal,
      });
      if (!active()) return;
      if (response.status === 401 || response.status === 403) {
        stop();
        callbacks.onError(new Error(`AUTH_${response.status}`));
        return;
      }
      if (!response.ok || !response.body) throw new Error(`HTTP_${response.status}`);
      if (!response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream")) {
        throw new Error("SSE_INVALID_CONTENT_TYPE");
      }
      callbacks.onOpen();
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (active()) {
        const { value, done } = await reader.read();
        if (!active()) return;
        if (done) throw new Error("STREAM_CLOSED");
        buffer += decoder.decode(value, { stream: true });
        let boundary: RegExpExecArray | null;
        while ((boundary = /\r?\n\r?\n/.exec(buffer)) !== null) {
          const chunk = buffer.slice(0, boundary.index);
          buffer = buffer.slice(boundary.index + boundary[0].length);
          retryDelayMs = 2000;
          parseSseChunk(chunk);
          if (!active()) return;
        }
      }
    } catch (error) {
      if (active()) callbacks.onError(error instanceof Error ? error : new Error("SSE_FETCH_FAILED"));
    } finally {
      attempt.abort();
      if (reader) {
        try { await reader.cancel(); } catch { /* already aborted */ }
        reader.releaseLock();
      }
      // An older request must never clear or reconnect a replacement subscription.
      if (controller === attempt) {
        controller = null;
        if (!stopped) {
          reconnectTimer = window.setTimeout(() => {
            reconnectTimer = null;
            void connect();
          }, retryDelayMs);
          retryDelayMs = Math.min(30_000, retryDelayMs * 2);
        }
      }
    }
  }

  function stop(): void {
    stopped = true;
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
    controller?.abort();
    controller = null;
    retryDelayMs = 2000;
  }

  function parseSseChunk(chunk: string): void {
    const lines = chunk.split(/\r?\n/);
    let eventName: string | null = null;
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
    }

    if (!dataLines.length) {
      return;
    }

    const payload = dataLines.join("\n");
    const items = parser(eventName, payload);
    for (const item of items) {
      callbacks.onMessage(item);
    }
  }

  return { start, stop };
}

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

export type SseLiveClient = SseClient;

export function createSseLiveClient(options: SseLiveClientOptions, callbacks: SseLiveClientCallbacks): SseLiveClient {
  return createSseClient<LiveClientUpdate>(
    getSseUrl(options),
    {
      onOpen: callbacks.onOpen,
      onMessage: (update) => {
        if (isLiveUpdateForSelection(update, options.deviceId, options.sessionId)) {
          if (options.sessionId && update.latestMetric) {
            console.debug("[LocalHub] session-live event", {
              sessionId: update.sessionId,
              compressionCount: update.latestMetric.compressionCount,
              pressureBalanceScorePct: update.latestMetric.pressureBalanceScorePct,
            });
          }
          callbacks.onUpdate(update);
        }
      },
      onError: callbacks.onError,
    },
    parseSsePayload,
  );
}

function getSseUrl(options: SseLiveClientOptions): string {
  if (options.sessionId) {
    return `${options.backendBaseUrl}/api/stream/sessions/live/${encodeURIComponent(options.sessionId)}`;
  }

  return `${options.backendBaseUrl}/api/stream/manikins/live`;
}

function parseSsePayload(_eventName: string | null, raw: string): LiveClientUpdate[] {
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
