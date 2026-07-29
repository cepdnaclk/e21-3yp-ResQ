import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectCalibrationStream,
  isEndedSessionPayload,
  subscribeToManikinsLive,
  subscribeToSessionLive,
} from "./liveEventsClient";

class MockEventSource {
  static instances: MockEventSource[] = [];

  onerror: (() => void) | null = null;
  closed = false;
  listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();

  constructor(
    public readonly url: string,
    public readonly options?: EventSourceInit,
  ) {
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: unknown) {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: payload } as MessageEvent<string>);
    }
  }
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("liveEventsClient", () => {
  it("subscribes to all manikin live updates and ignores malformed payloads after stop", () => {
    const onUpdate = vi.fn();
    const onError = vi.fn();

    const subscription = subscribeToManikinsLive(onUpdate, onError);
    const source = MockEventSource.instances[0];

    expect(source.url).toBe("http://localhost:18080/api/stream/manikins/live");
    expect(source.options).toEqual({ withCredentials: true });

    source.emit("manikins-live", [{ deviceId: "m1", status: "READY" }]);
    source.emit("manikins-live", { deviceId: "m2", status: "OFFLINE" });
    source.emit("manikins-live", "{not-json");
    source.onerror?.();

    expect(onUpdate).toHaveBeenNthCalledWith(1, [{ deviceId: "m1", status: "READY" }]);
    expect(onUpdate).toHaveBeenNthCalledWith(2, [{ deviceId: "m2", status: "OFFLINE" }]);
    expect(onError).toHaveBeenCalledWith(new Error("Manikins live stream connection error"));

    subscription.stop();
    source.emit("manikins-live", [{ deviceId: "m3" }]);
    source.onerror?.();

    expect(source.closed).toBe(true);
    expect(onUpdate).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("subscribes to session live updates, reports errors, and stops cleanly", () => {
    const onUpdate = vi.fn();
    const onEnded = vi.fn();
    const onError = vi.fn();

    const subscription = subscribeToSessionLive("session/1", "manikin-1", onUpdate, onEnded, onError);
    const source = MockEventSource.instances[0];

    expect(source.url).toBe("http://localhost:18080/api/stream/sessions/live/session%2F1");

    source.emit("session-live", { sessionId: "session/1", live: true });
    source.emit("session-live", "{not-json");
    source.onerror?.();

    expect(onUpdate).toHaveBeenCalledWith({ sessionId: "session/1", live: true });
    expect(onEnded).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(new Error("Session live stream connection error"));

    subscription.stop();
    source.emit("session-live", { sessionId: "session/1", live: false });
    expect(source.closed).toBe(true);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it.each([null, {}])("handles terminal payload %j exactly once and suppresses later callbacks", (terminalPayload) => {
    const onUpdate = vi.fn();
    const onEnded = vi.fn();
    const onError = vi.fn();

    const subscription = subscribeToSessionLive("session-1", "manikin-1", onUpdate, onEnded, onError);
    const source = MockEventSource.instances[0];

    source.emit("session-live", terminalPayload);
    source.emit("session-live", terminalPayload);
    source.emit("session-live", { sessionId: "session-1", live: false });
    source.onerror?.();
    subscription.stop();

    expect(source.closed).toBe(true);
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("recognizes backend completion markers without treating populated updates as ended", () => {
    expect(isEndedSessionPayload(null)).toBe(true);
    expect(isEndedSessionPayload(undefined)).toBe(true);
    expect(isEndedSessionPayload({})).toBe(true);
    expect(
      isEndedSessionPayload({
        sessionId: "session-1",
        active: false,
        lifecycleState: "COMPLETED",
      }),
    ).toBe(false);
  });

  it("routes calibration stream events to snapshot, update, final, and error handlers", () => {
    const handlers = {
      onSnapshot: vi.fn(),
      onUpdate: vi.fn(),
      onFinal: vi.fn(),
      onError: vi.fn(),
    };

    const source = connectCalibrationStream("manikin/1", handlers) as unknown as MockEventSource;

    expect(source.url).toBe("http://localhost:18080/api/stream/manikins/manikin%2F1/calibration");

    source.emit("calibration_snapshot", { type: "calibration_snapshot", value: 1 });
    source.emit("calibration_update", { type: "calibration_update", value: 2 });
    source.emit("calibration_final", { type: "calibration_final", value: 3 });
    source.emit("calibration_update", { type: "anything_else", eventId: 4002 });
    source.emit("calibration_update", { type: "calibration_keepalive" });
    source.emit("calibration_update", "{not-json");
    source.onerror?.();

    expect(handlers.onSnapshot).toHaveBeenCalledWith({ type: "calibration_snapshot", value: 1 });
    expect(handlers.onUpdate).toHaveBeenCalledWith({ type: "calibration_update", value: 2 });
    expect(handlers.onFinal).toHaveBeenNthCalledWith(1, { type: "calibration_final", value: 3 });
    expect(handlers.onFinal).toHaveBeenNthCalledWith(2, { type: "anything_else", eventId: 4002 });
    expect(handlers.onError).toHaveBeenCalledWith(new Error("Calibration stream connection error"));
  });
});
