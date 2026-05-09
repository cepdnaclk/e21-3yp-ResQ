import { useEffect, useMemo, useState } from "react";
import {
  createLiveClient,
  getDefaultBackendBaseUrl,
  getDefaultMqttWebSocketUrl,
  type LiveClientOptions,
  type LiveClientState,
} from "../lib/liveClient";

export type UseLiveSessionOptions = {
  deviceId: string | null | undefined;
  sessionId?: string | null;
  enabled?: boolean;
  mqttUrl?: string;
  backendBaseUrl?: string;
};

export function useLiveSession(options: UseLiveSessionOptions): LiveClientState {
  const enabled = options.enabled ?? true;
  const deviceId = options.deviceId?.trim() ?? "";
  const sessionId = options.sessionId?.trim() || null;
  const mqttUrl = options.mqttUrl ?? getDefaultMqttWebSocketUrl();
  const backendBaseUrl = options.backendBaseUrl ?? getDefaultBackendBaseUrl();

  const clientOptions = useMemo<LiveClientOptions>(
    () => ({
      deviceId,
      sessionId,
      enabled: enabled && deviceId.length > 0,
      mqttUrl,
      backendBaseUrl,
    }),
    [backendBaseUrl, deviceId, enabled, mqttUrl, sessionId],
  );

  const [state, setState] = useState<LiveClientState>(() => ({
    deviceId,
    sessionId,
    latestMetric: null,
    lastSeenAt: null,
    connectionState: clientOptions.enabled ? "CONNECTING" : "OFFLINE",
    sourceMode: "NONE",
    stale: false,
    offline: !clientOptions.enabled,
    message: null,
    lastHeartbeatAt: null,
    lastStatusAt: null,
    lastEventType: null,
    error: null,
  }));

  useEffect(() => {
    setState((previous) => ({
      ...previous,
      deviceId,
      sessionId,
      connectionState: clientOptions.enabled ? "CONNECTING" : "OFFLINE",
      sourceMode: "NONE",
      stale: false,
      offline: !clientOptions.enabled,
      error: null,
      message: null,
    }));

    if (!clientOptions.enabled) {
      return undefined;
    }

    const subscription = createLiveClient(clientOptions, setState);
    return () => {
      subscription.stop();
    };
  }, [clientOptions, deviceId, sessionId]);

  return state;
}
