import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSseClient, type SseClient } from "./sseLiveClient";
import { setStoredToken } from "./tokenStore";
let client: SseClient;
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
beforeEach(() => { vi.useFakeTimers(); setStoredToken("test-token"); });
afterEach(() => { client?.stop(); setStoredToken(null); vi.useRealTimers(); vi.unstubAllGlobals(); });
function start() {
  const callbacks = { onOpen: vi.fn(), onMessage: vi.fn(), onError: vi.fn() };
  client = createSseClient("http://127.0.0.1:18080/api/stream/manikins/live", callbacks, (_, data) => [data]);
  client.start();
  return callbacks;
}
it("retries server failures with bounded backoff and cancels on stop", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
  vi.stubGlobal("fetch", fetchMock);
  start(); await flush();
  await vi.advanceTimersByTimeAsync(1999); expect(fetchMock).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(fetchMock).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(4000); expect(fetchMock).toHaveBeenCalledTimes(3);
  client.stop(); await vi.advanceTimersByTimeAsync(60_000); expect(fetchMock).toHaveBeenCalledTimes(3);
});
it.each([401, 403])("reports HTTP %s without an authentication retry loop", async (status) => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status }));
  vi.stubGlobal("fetch", fetchMock);
  const cb = start(); await flush();
  expect(cb.onError).toHaveBeenCalledWith(new Error(`AUTH_${status}`));
  await vi.advanceTimersByTimeAsync(60_000); expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("parses split CRLF frames and reconnects after a backend disconnect", async () => {
  let source: ReadableStreamDefaultController<Uint8Array>;
  const fetchMock = vi.fn().mockImplementation(async () => new Response(new ReadableStream({ start(c) { source = c; } }), { headers: { "Content-Type": "text/event-stream" } }));
  vi.stubGlobal("fetch", fetchMock);
  const cb = start(); client.start(); await flush();
  source!.enqueue(new TextEncoder().encode("event: update\r\ndata: hello\r\n\r")); await flush();
  source!.enqueue(new TextEncoder().encode("\n")); await flush();
  expect(cb.onMessage).toHaveBeenCalledExactlyOnceWith("hello");
  source!.close(); await flush();
  await vi.advanceTimersByTimeAsync(2000); expect(fetchMock).toHaveBeenCalledTimes(2);
});
it("rejects HTML responses instead of falsely reporting a live stream", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html/>", { headers: { "Content-Type": "text/html" } })));
  const cb = start(); await flush();
  expect(cb.onOpen).not.toHaveBeenCalled();
  expect(cb.onError).toHaveBeenCalledWith(new Error("SSE_INVALID_CONTENT_TYPE"));
});
