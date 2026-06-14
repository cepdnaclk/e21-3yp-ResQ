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
  let stopped = false;
  let reconnectTimer: number | null = null;

  function start(): void {
    void startAsync();
  }

  async function startAsync(): Promise<void> {
    stopped = false;
    if (controller) return;

    const token = getStoredToken();
    if (!token) {
      callbacks.onError(new Error("AUTH_REQUIRED"));
      return;
    }

    controller = new AbortController();
    const signal = controller.signal;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "text/event-stream",
        },
        signal,
      });

      if (response.status === 401 || response.status === 403) {
        callbacks.onError(new Error(`AUTH_${response.status}`));
        stop();
        return;
      }

      if (!response.ok || !response.body) {
        callbacks.onError(new Error(`HTTP_${response.status || 0}`));
        stop();
        if (!reconnectTimer) {
          reconnectTimer = window.setTimeout(() => {
            reconnectTimer = null;
            if (!stopped) {
              startAsync();
            }
          }, 2000);
        }
        return;
      }

      callbacks.onOpen();
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (!stopped) {
        const { value, done } = await reader.read();
        if (done) {
          if (!stopped) {
            callbacks.onError(new Error("STREAM_CLOSED"));
            if (!reconnectTimer) {
              reconnectTimer = window.setTimeout(() => {
                reconnectTimer = null;
                if (!stopped) {
                  startAsync();
                }
              }, 2000);
            }
          }
          break;
        }

        if (value) {
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const chunk = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            parseSseChunk(chunk);
            boundary = buffer.indexOf("\n\n");
          }
        }
      }

      if (!stopped && buffer.trim()) {
        parseSseChunk(buffer.trim());
      }
    } catch (error) {
      if (stopped) return;
      const err = error as Error & { name?: string };
      if (err.name === "AbortError") {
        return;
      }

      callbacks.onError(new Error("SSE_FETCH_FAILED"));
      if (!reconnectTimer) {
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null;
          if (!stopped) {
            startAsync();
          }
        }, 2000);
      }
    } finally {
      if (controller) {
        controller = null;
      }
    }
  }

  function stop(): void {
    stopped = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (controller) {
      try {
        controller.abort();
      } catch {}
      controller = null;
    }
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
              pressureBalancePct: update.latestMetric.pressureBalancePct,
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
