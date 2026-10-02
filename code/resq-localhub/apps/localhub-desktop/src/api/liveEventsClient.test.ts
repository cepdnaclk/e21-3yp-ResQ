import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { subscribeToManikinsLive, subscribeToSessionLive, connectCalibrationStream, isEndedSessionPayload } from "./liveEventsClient";
import { setStoredToken } from "../lib/tokenStore";
let controller: ReadableStreamDefaultController<Uint8Array>;
let fetchMock: ReturnType<typeof vi.fn>;
let stop: (() => void) | undefined;
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const emit = async (name: string, data: unknown) => {
  controller.enqueue(new TextEncoder().encode(`event: ${name}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`));
  await flush();
};
beforeEach(() => {
  setStoredToken("test-token");
  fetchMock = vi.fn().mockImplementation(async () => new Response(new ReadableStream({ start(c) { controller = c; } }), { headers: { "Content-Type": "text/event-stream" } }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { stop?.(); stop = undefined; setStoredToken(null); vi.unstubAllGlobals(); });
it("authenticates manikin SSE without relying on cross-site cookies", async () => {
  const update = vi.fn();
  const sub = subscribeToManikinsLive(update); stop = sub.stop;
  await flush();
  expect(fetchMock).toHaveBeenCalledWith("http://localhost:18080/api/stream/manikins/live", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-token" }) }));
  await emit("heartbeat", {});
  await emit("manikins-live", [{ deviceId: "m1" }]);
  expect(update).toHaveBeenCalledExactlyOnceWith([{ deviceId: "m1" }]);
  sub.stop();
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
});
it.each([null, {}])("closes session SSE on terminal payload %j", async (terminal) => {
  const update = vi.fn(), ended = vi.fn();
  const sub = subscribeToSessionLive("s/1", "m1", update, ended); stop = sub.stop;
  await flush();
  expect(fetchMock.mock.calls[0][0]).toContain("sessions/live/s%2F1");
  await emit("session-live", { sessionId: "s/1" });
  await emit("session-live", terminal);
  expect(update).toHaveBeenCalledTimes(1);
  expect(ended).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
});
it("routes calibration events through the authenticated stream", async () => {
  const handlers = { onSnapshot: vi.fn(), onUpdate: vi.fn(), onFinal: vi.fn(), onError: vi.fn() };
  const sub = connectCalibrationStream("m/1", handlers); stop = sub.close;
  await flush();
  await emit("calibration_snapshot", { type: "calibration_snapshot" });
  await emit("calibration_update", { type: "calibration_update" });
  await emit("calibration_final", { type: "calibration_final" });
  expect(handlers.onSnapshot).toHaveBeenCalledTimes(1);
  expect(handlers.onUpdate).toHaveBeenCalledTimes(1);
  expect(handlers.onFinal).toHaveBeenCalledTimes(1);
});
it("recognizes completion without rejecting populated snapshots", () => {
  expect(isEndedSessionPayload(undefined)).toBe(true);
  expect(isEndedSessionPayload({ active: false })).toBe(false);
});
