/** Authenticated SSE subscriptions shared by desktop and LAN dashboards. */
import { createSseClient, createSseLiveClient, type SseLiveClient, type SseLiveClientCallbacks } from "../lib/sseLiveClient";
import { getHubApiBaseUrl } from "../lib/hubApiUrl";
import type { ManikinLiveSummary, CalibrationStreamEvent } from "../types/manikin";
import type { SessionLiveView } from "../types/live";

export type ManikinsLiveUpdate = ManikinLiveSummary[];
export type ManikinsLiveSubscription = { stop(): void };
export type SessionLiveSubscription = { stop(): void };

export function isEndedSessionPayload(value: unknown): value is null | undefined | Record<string, never> {
  return value == null || (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0);
}

function subscribe(path: string, events: string[], onMessage: (value: unknown) => void, onError?: (error: Error) => void) {
  const stream = createSseClient<unknown>(getHubApiBaseUrl() + path, {
    onOpen() {}, onMessage, onError: (error) => onError?.(error),
  }, (event, data) => {
    if (!event || !events.includes(event)) return [];
    try { return [JSON.parse(data)]; } catch { return []; }
  });
  stream.start();
  return stream;
}

export function subscribeToManikinsLive(onUpdate: (manikins: ManikinsLiveUpdate) => void, onError?: (error: Error) => void): ManikinsLiveSubscription {
  return subscribe("/api/stream/manikins/live", ["manikins-live"], (value) => {
    onUpdate((Array.isArray(value) ? value : [value]) as ManikinsLiveUpdate);
  }, onError);
}

export function subscribeToSessionLive(sessionId: string, _deviceId: string, onUpdate: (view: SessionLiveView) => void, onEnded: () => void, onError?: (error: Error) => void): SessionLiveSubscription {
  const stream = subscribe(`/api/stream/sessions/live/${encodeURIComponent(sessionId)}`, ["session-live"], (value) => {
    if (isEndedSessionPayload(value)) { stream.stop(); onEnded(); }
    else onUpdate(value as SessionLiveView);
  }, onError);
  return stream;
}

export function connectCalibrationStream(deviceId: string, handlers: {
  onSnapshot(event: CalibrationStreamEvent): void;
  onUpdate(event: CalibrationStreamEvent): void;
  onFinal(event: CalibrationStreamEvent): void;
  onError(error: Error): void;
}): { close(): void } {
  const stream = subscribe(`/api/stream/manikins/${encodeURIComponent(deviceId)}/calibration`,
    ["calibration_snapshot", "calibration_update", "calibration_final"], (value) => {
      const event = value as CalibrationStreamEvent;
      if (!event || event.type === "calibration_keepalive") return;
      if (event.type === "calibration_snapshot") handlers.onSnapshot(event);
      else if (event.type === "calibration_update") handlers.onUpdate(event);
      else if (event.type === "calibration_final" || event.eventId === 4002) handlers.onFinal(event);
    }, handlers.onError);
  return { close: () => stream.stop() };
}

export { createSseLiveClient };
export type { SseLiveClient, SseLiveClientCallbacks };
