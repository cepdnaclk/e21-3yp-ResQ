import { useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode } from "react";
import ReactJson from "react-json-view";
import { type ManikinLiveSummary } from "../lib/browserManikinsApi";
import {
  getFirmwareDiagnostics,
  requestFirmwareDebugSnapshot,
  type FirmwareDeviceDiagnosticsResponse,
  type FirmwareReadinessResponse,
} from "../lib/browserFirmwareApi";
import {
  createSensorStreamClient,
  getLatestSensorStream,
  startSensorStream,
  stopSensorStream,
} from "../lib/sensorStreamClient";
import {
  SENSOR_STREAM_DEFAULT_INTERVAL_MS,
  SENSOR_STREAM_MAX_INTERVAL_MS,
  SENSOR_STREAM_MIN_INTERVAL_MS,
  validateSensorStreamInterval,
  type SensorStreamCommandResponse,
  type SensorStreamSnapshot,
  type SensorStreamUiState,
} from "../lib/sensorStreamTypes";

type FirmwareDiagnosticsPanelProps = {
  deviceId: string;
  readiness?: FirmwareReadinessResponse | null;
  liveSummary?: ManikinLiveSummary | null;
};

export function FirmwareDiagnosticsPanel({ deviceId, readiness, liveSummary }: FirmwareDiagnosticsPanelProps) {
  const [diagnostics, setDiagnostics] = useState<FirmwareDeviceDiagnosticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [debugRequestState, setDebugRequestState] = useState<"idle" | "sending">("idle");
  const [error, setError] = useState<string | null>(null);
  const [polledReadiness, setPolledReadiness] = useState<FirmwareReadinessResponse | null>(null);
  const [glowReady, setGlowReady] = useState(false);
  const [retryBounce, setRetryBounce] = useState(false);
  const [liveTail, setLiveTail] = useState(true);
  const logViewportRef = useRef<HTMLDivElement | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const response = await getFirmwareDiagnostics(deviceId);
        if (!cancelled) {
          setDiagnostics(response);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setDiagnostics(null);
          setError(loadError instanceof Error ? loadError.message : "Failed to load firmware diagnostics.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  useEffect(() => {
    let cancelled = false;

    async function pollReadiness() {
      try {
        const response = await getFirmwareDiagnostics(deviceId);
        if (!cancelled) {
          setPolledReadiness(response.readiness ?? null);
        }
      } catch {
        if (!cancelled) {
          setPolledReadiness(null);
        }
      }
    }

    void pollReadiness();
    const interval = window.setInterval(pollReadiness, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [deviceId]);

  async function refresh() {
    setRefreshing(true);
    try {
      const response = await getFirmwareDiagnostics(deviceId);
      setDiagnostics(response);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load firmware diagnostics.");
    } finally {
      setRefreshing(false);
    }
  }

  async function requestDebugSnapshot() {
    setDebugRequestState("sending");
    try {
      await requestFirmwareDebugSnapshot(deviceId);
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to request a debug snapshot.");
    } finally {
      setDebugRequestState("idle");
    }
  }

  async function handleRetryCalibration() {
    setRetryBounce(true);
    window.setTimeout(() => setRetryBounce(false), 900);
    await requestDebugSnapshot();
  }

  const currentReadiness = readiness ?? diagnostics?.readiness ?? polledReadiness ?? null;
  const latestCalibration = diagnostics?.latestCalibration ?? null;
  const recentCommands = diagnostics?.recentCommands ?? [];
  const recentEvents = diagnostics?.recentEvents ?? [];
  const recentDebugSnapshots = diagnostics?.recentDebugSnapshots ?? [];
  const latestDebugSnapshot = recentDebugSnapshots[0] ?? null;
  const latestLiveSummary = liveSummary ?? diagnostics?.liveSummary ?? null;
  const calibrationNeeded = Boolean(currentReadiness && !currentReadiness.readyForSession);
  const calibrationProgress = mapProgressId(currentReadiness?.progressId ?? null);
  const readinessTimelineStep = mapTimelineStep(currentReadiness?.progressId ?? null);
  const commandGroups = useMemo(() => groupCommandsByHour(recentCommands), [recentCommands]);

  useEffect(() => {
    if (!currentReadiness?.readyForSession) {
      return;
    }

    setGlowReady(true);
    const timer = window.setTimeout(() => setGlowReady(false), 1200);
    return () => window.clearTimeout(timer);
  }, [currentReadiness?.readyForSession, deviceId]);

  useEffect(() => {
    if (!liveTail) {
      return;
    }

    const viewport = logViewportRef.current;
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }

    const logEnd = logEndRef.current;
    if (logEnd && typeof logEnd.scrollIntoView === "function") {
      logEnd.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [liveTail, recentCommands.length, recentEvents.length, recentDebugSnapshots.length]);

  return (
    <details style={{ border: "1px solid var(--line)", borderRadius: "8px", background: "var(--surface-soft)", padding: "10px" }}>
      <summary style={{ cursor: "pointer", fontWeight: 700, color: "var(--text)" }}>Firmware Diagnostics</summary>
      <div style={{ display: "grid", gap: "10px", marginTop: "10px" }}>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing || loading}
            style={buttonStyle(refreshing || loading)}
          >
            {refreshing || loading ? "Refreshing..." : "Refresh diagnostics"}
          </button>
          <button
            type="button"
            onClick={requestDebugSnapshot}
            disabled={debugRequestState === "sending"}
            style={buttonStyle(debugRequestState === "sending")}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              {debugRequestState === "sending" ? <span className="debug-request-pulse" aria-hidden="true" /> : null}
              {debugRequestState === "sending" ? "Requesting debug..." : "Request Debug Snapshot"}
            </span>
          </button>
        </div>

        {error ? (
          <p style={{ margin: 0, color: "#b91c1c", fontSize: "0.84rem" }}>{error}</p>
        ) : null}

        <div style={gridStyle}>
          <ReadinessBlock
            readiness={currentReadiness}
            calibrationNeeded={calibrationNeeded}
            calibrationProgress={calibrationProgress}
            readinessTimelineStep={readinessTimelineStep}
            glowReady={glowReady}
            retryBounce={retryBounce}
            onRetryCalibration={handleRetryCalibration}
          />
          <InfoRow label="Calibration" value={latestCalibration ? `${latestCalibration.result ?? "-"} (${latestCalibration.status ?? "-"})` : "-"} />
          <InfoRow label="Live State" value={latestLiveSummary ? `${latestLiveSummary.state ?? "-"} / ${latestLiveSummary.online ? "Online" : "Offline"}` : "-"} />
          <InfoRow label="Commands" value={String(recentCommands.length)} />
          <InfoRow label="Events" value={String(recentEvents.length)} />
          <InfoRow label="Debug Snapshots" value={String(recentDebugSnapshots.length)} />
        </div>

        <SensorStreamPanel deviceId={deviceId} />

        <Section title="Recent Commands & Events">
          <div className="diagnostics-log-shell">
            <div className="diagnostics-log-shell__header">
                <div>
                  <div style={{ fontSize: "0.82rem", fontWeight: 800, color: "var(--card-fg)" }}>Live Tail</div>
                  <div style={{ fontSize: "0.74rem", color: "var(--muted)" }}>Auto-scrolls to the newest row when enabled.</div>
                </div>
              <label className="diagnostics-toggle">
                <input type="checkbox" checked={liveTail} onChange={(event) => setLiveTail(event.target.checked)} />
                <span>Live Tail</span>
              </label>
            </div>

            <div ref={logViewportRef} className="diagnostics-log-shell__viewport">
              <div className="diagnostics-log-shell__scanline" aria-hidden="true" />

              {commandGroups.length === 0 && recentEvents.length === 0 ? (
                <EmptyText text="No recent command requests or firmware events." />
              ) : null}

              {commandGroups.map((group) => (
                <div key={group.hourKey} className="diagnostics-hour-group">
                  <div className="diagnostics-hour-group__header">{group.label}</div>
                  <div className="diagnostics-hour-group__rows">
                    {group.commands.map((command) => (
                      <CommandRow key={command.requestId} command={command} />
                    ))}
                  </div>
                </div>
              ))}

              {recentEvents.length > 0 ? (
                <div className="diagnostics-hour-group">
                  <div className="diagnostics-hour-group__header">Events</div>
                  <div className="diagnostics-hour-group__rows">
                    {recentEvents.slice(0, 8).map((event) => (
                      <EventRow key={event.id} event={event} />
                    ))}
                  </div>
                </div>
              ) : null}

              <div ref={logEndRef} />
            </div>
          </div>
        </Section>

        <Section title="Debug Snapshots">
          {recentDebugSnapshots.length === 0 ? (
            <EmptyText text="No debug snapshots recorded yet." />
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {recentDebugSnapshots.slice(0, 3).map((snapshot) => (
                <details key={snapshot.id} className="diagnostics-json-shell" open={snapshot.id === latestDebugSnapshot?.id}>
                  <summary className="diagnostics-json-shell__summary">
                    <span>Snapshot {snapshot.id}</span>
                    <span>{snapshot.receivedAt}</span>
                  </summary>
                  <div className="diagnostics-json-shell__body">
                    <ReactJson
                      src={snapshotToTree(snapshot)}
                      name={false}
                      collapsed={2}
                      displayDataTypes={false}
                      enableClipboard={false}
                      theme="monokai"
                      style={{ background: "transparent", fontSize: "0.8rem" }}
                    />
                  </div>
                </details>
              ))}
            </div>
          )}
        </Section>
      </div>
    </details>
  );
}

function ReadinessBlock({
  readiness,
  calibrationNeeded,
  calibrationProgress,
  readinessTimelineStep,
  glowReady,
  retryBounce,
  onRetryCalibration,
}: {
  readiness: FirmwareReadinessResponse | null;
  calibrationNeeded: boolean;
  calibrationProgress: number;
  readinessTimelineStep: number;
  glowReady: boolean;
  retryBounce: boolean;
  onRetryCalibration: () => void;
}) {
  const ready = Boolean(readiness?.readyForSession);
  const statusLabel = ready ? "Ready for session" : readiness ? "Calibration needed" : "No readiness data";

  return (
    <div className={`readiness-block ${calibrationNeeded ? "readiness-block--needs-calibration" : ""} ${glowReady ? "readiness-block--glow" : ""}`}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div className={`readiness-block__icon ${ready ? "readiness-block__icon--ready" : "readiness-block__icon--not-ready"}`}>
            {ready ? <ReadyIcon /> : <NotReadyIcon />}
          </div>
          <div>
            <div style={{ fontSize: "0.74rem", fontWeight: 800, color: ready ? "#166534" : "#b91c1c", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Readiness
            </div>
            <div style={{ fontSize: "0.92rem", fontWeight: 700, color: "var(--text)" }}>{statusLabel}</div>
          </div>
        </div>

        <button type="button" className={`readiness-retry-button ${retryBounce ? "readiness-retry-button--bounce" : ""}`} onClick={onRetryCalibration}>
          Retry Calibration
        </button>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <Timeline
          progressId={readiness?.progressId ?? null}
          step={readinessTimelineStep}
          progress={calibrationProgress}
        />

        <div style={{ display: "grid", gap: 8 }}>
          <div style={readinessInfoRowStyle}>
            <span style={{ ...readinessInfoLabelStyle, color: "var(--muted)" }}>State</span>
            <span style={{ ...readinessInfoValueStyle, color: "var(--text)" }}>{readiness?.firmwareState ?? "-"}</span>
          </div>
          <div style={readinessInfoRowStyle}>
            <span style={{ ...readinessInfoLabelStyle, color: "var(--muted)" }}>Status</span>
            <span style={{ ...readinessInfoValueStyle, color: "var(--text)" }}>{ready ? "Ready" : "Not ready"}</span>
          </div>
          <div style={cubeRowStyle} className="readiness-cube-row">
            <span style={readinessInfoLabelStyle}>Raw IDs</span>
            <div className="readiness-cube-row__cube-wrap">
              <div className="readiness-cube" aria-label="Raw readiness IDs cube">
                <div className="readiness-cube__face">progress_id: {readiness?.progressId ?? "-"}</div>
                <div className="readiness-cube__face">reason_id: {readiness?.reasonId ?? "-"}</div>
                <div className="readiness-cube__face">action_id: {readiness?.actionId ?? "-"}</div>
                <div className="readiness-cube__face">{ready ? "ready" : "not ready"}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SensorStreamPanel({ deviceId }: { deviceId: string }) {
  const [intervalInput, setIntervalInput] = useState(String(SENSOR_STREAM_DEFAULT_INTERVAL_MS));
  const [uiState, setUiState] = useState<SensorStreamUiState>("IDLE");
  const [snapshot, setSnapshot] = useState<SensorStreamSnapshot | null>(null);
  const [command, setCommand] = useState<SensorStreamCommandResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastPacketAt, setLastPacketAt] = useState<number | null>(null);
  const expectedStreamRef = useRef(false);
  const stopTimerRef = useRef<number | null>(null);
  const staleTimerRef = useRef<number | null>(null);

  const intervalError = validateSensorStreamInterval(intervalInput);
  const intervalMs = intervalError ? SENSOR_STREAM_DEFAULT_INTERVAL_MS : Number(intervalInput);
  const observedStatus = observedStreamStatus(uiState);
  const commandLabel = command ? `${command.action} command ${command.status.toLowerCase()}` : "No command sent";
  const ageMs = lastPacketAt == null ? null : Math.max(0, Date.now() - lastPacketAt);

  useEffect(() => {
    let cancelled = false;
    setSnapshot(null);
    setCommand(null);
    setError(null);
    setUiState("IDLE");
    setLastPacketAt(null);
    expectedStreamRef.current = false;
    clearTimer(stopTimerRef);
    clearTimer(staleTimerRef);

    getLatestSensorStream(deviceId)
      .then((latest) => {
        if (!cancelled && latest?.latestSnapshot?.deviceId === deviceId) {
          setSnapshot(latest.latestSnapshot);
          setLastPacketAt(Date.now());
        }
      })
      .catch((latestError) => {
        if (!cancelled) {
          const status = (latestError as Error & { status?: number }).status;
          if (status !== 404) {
            setError(latestError instanceof Error ? latestError.message : "Failed to load latest sensor snapshot.");
          }
        }
      });

    const client = createSensorStreamClient(deviceId, {
      onOpen: () => {
        if (!cancelled && expectedStreamRef.current) {
          setUiState((current) => current === "RECONNECTING" || current === "STALE" ? "RECONNECTING" : current);
        }
      },
      onSnapshot: (next) => {
        if (cancelled || next.deviceId !== deviceId) {
          return;
        }
        setSnapshot(next);
        setLastPacketAt(Date.now());
        if (expectedStreamRef.current) {
          setUiState((current) => current === "STOPPING" ? current : "RUNNING");
        }
      },
      onError: (streamError) => {
        if (cancelled) {
          return;
        }
        if (expectedStreamRef.current) {
          setUiState((current) => current === "STOPPING" ? current : "RECONNECTING");
        }
        setError(streamError.message);
      },
    });

    client.start();
    return () => {
      cancelled = true;
      client.stop();
      clearTimer(stopTimerRef);
      clearTimer(staleTimerRef);
    };
  }, [deviceId]);

  useEffect(() => {
    clearTimer(staleTimerRef);
    if (uiState !== "RUNNING" || lastPacketAt == null) {
      return;
    }
    const threshold = Math.max(3 * (snapshot?.intervalMs ?? intervalMs), 1500);
    staleTimerRef.current = window.setInterval(() => {
      if (expectedStreamRef.current && Date.now() - lastPacketAt > threshold) {
        setUiState("STALE");
      }
    }, 250);
    return () => clearTimer(staleTimerRef);
  }, [uiState, lastPacketAt, intervalMs, snapshot?.intervalMs]);

  async function handleStart() {
    const validationError = validateSensorStreamInterval(intervalInput);
    if (validationError) {
      setError(validationError);
      return;
    }

    expectedStreamRef.current = true;
    setUiState("STARTING");
    setError(null);
    try {
      const response = await startSensorStream(deviceId, Number(intervalInput));
      setCommand(response);
    } catch (startError) {
      expectedStreamRef.current = false;
      setUiState("ERROR");
      setError(startError instanceof Error ? startError.message : "Failed to publish start command.");
    }
  }

  async function handleStop() {
    expectedStreamRef.current = false;
    setUiState("STOPPING");
    setError(null);
    try {
      const response = await stopSensorStream(deviceId);
      setCommand(response);
      clearTimer(stopTimerRef);
      stopTimerRef.current = window.setTimeout(() => {
        setUiState("IDLE");
      }, Math.max(3 * (snapshot?.intervalMs ?? intervalMs), 1500));
    } catch (stopError) {
      setUiState("ERROR");
      setError(stopError instanceof Error ? stopError.message : "Failed to publish stop command.");
    }
  }

  const startDisabled = Boolean(intervalError) || uiState === "STARTING" || uiState === "RUNNING" || uiState === "STOPPING";
  const stopDisabled = !(uiState === "STARTING" || uiState === "RUNNING" || uiState === "STALE" || uiState === "RECONNECTING");

  return (
    <Section title="Live Sensor Stream">
      <div style={sensorPanelStyle}>
        <div style={sensorControlRowStyle}>
          <label style={sensorInputLabelStyle} htmlFor={`sensor-interval-${deviceId}`}>
            Interval (ms)
            <input
              id={`sensor-interval-${deviceId}`}
              type="number"
              min={SENSOR_STREAM_MIN_INTERVAL_MS}
              max={SENSOR_STREAM_MAX_INTERVAL_MS}
              step={1}
              value={intervalInput}
              onChange={(event) => setIntervalInput(event.target.value)}
              aria-invalid={Boolean(intervalError)}
              aria-describedby={intervalError ? `sensor-interval-error-${deviceId}` : undefined}
              style={sensorInputStyle}
            />
          </label>
          <button type="button" onClick={handleStart} disabled={startDisabled} style={buttonStyle(startDisabled)}>
            Start Stream
          </button>
          <button type="button" onClick={handleStop} disabled={stopDisabled} style={buttonStyle(stopDisabled)}>
            Stop Stream
          </button>
        </div>

        {intervalError ? (
          <p id={`sensor-interval-error-${deviceId}`} role="alert" style={sensorErrorStyle}>{intervalError}</p>
        ) : null}
        {error ? <p role="alert" style={sensorErrorStyle}>{error}</p> : null}

        <div role="status" aria-live="polite" style={sensorStatusGridStyle}>
          <InfoRow label="Selected Device" value={deviceId} />
          <InfoRow label="Command Status" value={commandLabel} />
          <InfoRow label="Observed Stream" value={observedStatus} />
          <InfoRow label="Firmware State" value={snapshot?.state ?? "-"} />
          <InfoRow label="Firmware ts_ms" value={snapshot ? String(snapshot.firmwareTimestampMs) : "-"} />
          <InfoRow label="Received" value={snapshot ? formatWallClock(snapshot.receivedAt) : "-"} />
          <InfoRow label="Age" value={ageMs == null ? "-" : formatAge(ageMs)} />
          <InfoRow label="Saturation Mask" value={snapshot ? `0b${snapshot.pressureSaturationMask.toString(2).padStart(3, "0")}` : "-"} />
        </div>

        <div style={sensorStatusGridStyle}>
          <SensorValueCard
            label="Pressure 0"
            value={pressureDisplay(snapshot, 0)}
            detail={snapshot?.pressureKpaValid === false ? "Pressure data degraded" : "All required pressure channels valid"}
          />
          <SensorValueCard
            label="Pressure 1"
            value={pressureDisplay(snapshot, 1)}
            detail={snapshot?.pressureKpaValid === false ? "Pressure data degraded" : "All required pressure channels valid"}
          />
          <SensorValueCard
            label="Pressure 2"
            value={pressureDisplay(snapshot, 2)}
            detail={snapshot?.pressureKpaValid === false ? "Pressure data degraded" : "All required pressure channels valid"}
          />
          <HallCard snapshot={snapshot} />
        </div>
      </div>
    </Section>
  );
}

function SensorValueCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div role="group" aria-label={label} style={sensorCardStyle}>
      <div style={entryTitleStyle}>{label}</div>
      <div style={sensorValueStyle}>{value}</div>
      <div style={entryMetaStyle}>{detail}</div>
    </div>
  );
}

function HallCard({ snapshot }: { snapshot: SensorStreamSnapshot | null }) {
  const valid = Boolean(snapshot?.hallMmValid);
  const visualProgress = valid && snapshot ? Math.max(0, Math.min(100, snapshot.hallProgress * 100)) : 0;
  return (
    <div role="group" aria-label="Hall" style={sensorCardStyle}>
      <div style={entryTitleStyle}>Hall</div>
      <div style={sensorValueStyle}>{valid && snapshot ? `${snapshot.hallMm.toFixed(1)} mm` : "Unavailable"}</div>
      <div style={entryMetaStyle}>Progress: {valid && snapshot ? `${Math.round(snapshot.hallProgress * 100)}%` : "Unavailable"}</div>
      <div
        role={valid ? "progressbar" : undefined}
        aria-valuenow={valid ? Math.round(visualProgress) : undefined}
        aria-valuemin={valid ? 0 : undefined}
        aria-valuemax={valid ? 100 : undefined}
        style={sensorProgressTrackStyle}
      >
        <div style={{ ...sensorProgressFillStyle, width: `${valid ? visualProgress : 0}%`, opacity: valid ? 1 : 0.35 }} />
      </div>
    </div>
  );
}

function pressureDisplay(snapshot: SensorStreamSnapshot | null, channel: 0 | 1 | 2): string {
  if (!snapshot) {
    return "-";
  }

  if ((snapshot.pressureSaturationMask & (1 << channel)) !== 0) {
    return "Saturated";
  }

  const value = channel === 0 ? snapshot.pressure0Kpa : channel === 1 ? snapshot.pressure1Kpa : snapshot.pressure2Kpa;
  const valid = channel === 0 ? snapshot.pressure0KpaValid : channel === 1 ? snapshot.pressure1KpaValid : snapshot.pressure2KpaValid;
  if (!valid) {
    return "Unavailable";
  }
  return `${formatSensorNumber(value)} kPa`;
}

function observedStreamStatus(uiState: SensorStreamUiState): string {
  switch (uiState) {
    case "STARTING":
      return "Waiting for first packet";
    case "RUNNING":
      return "Running";
    case "STOPPING":
      return "Stopping";
    case "STALE":
      return "Stale";
    case "RECONNECTING":
      return "Reconnecting";
    case "ERROR":
      return "Error";
    case "IDLE":
    default:
      return "Stopped";
  }
}

function formatSensorNumber(value: number): string {
  return value.toFixed(Math.abs(value) < 10 ? 1 : 0);
}

function formatWallClock(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatAge(ageMs: number): string {
  if (ageMs < 1000) {
    return `${ageMs} ms`;
  }
  return `${(ageMs / 1000).toFixed(1)} s`;
}

function clearTimer(ref: MutableRefObject<number | null>) {
  if (ref.current !== null) {
    window.clearTimeout(ref.current);
    ref.current = null;
  }
}

function ReadyIcon() {
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" fill="none" aria-hidden="true">
      <circle cx="26" cy="26" r="22" fill="#dcfce7" stroke="#22c55e" strokeWidth="2.5" />
      <path d="M17 26.5 23.5 33 35 20" stroke="#16a34a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NotReadyIcon() {
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" fill="none" aria-hidden="true">
      <circle cx="26" cy="26" r="22" fill="#fee2e2" stroke="#ef4444" strokeWidth="2.5" />
      <path d="M20 20 32 32M32 20 20 32" stroke="#dc2626" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

function Timeline({ progressId, step, progress }: { progressId: number | null; step: number; progress: number }) {
  const steps = ["Calibrating", "Measuring", "Validating", "Ready"];
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={timelineTrackStyle}>
        {steps.map((item, index) => (
          <div key={item} style={timelineStepStyle}>
            <span className={`timeline-step__dot ${index <= step ? "timeline-step__dot--active" : ""}`} />
            <span style={{ fontSize: "0.74rem", fontWeight: 700, color: index <= step ? "#0f172a" : "#64748b" }}>{item}</span>
          </div>
        ))}
        <div className="timeline-step__mover" style={{ left: `${Math.min(100, Math.max(0, progress))}%` }} />
      </div>
      <div style={{ fontSize: "0.75rem", color: "#64748b", display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span>progress_id: {progressId ?? "-"}</span>
        <span>{Math.round(progress)}%</span>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: "8px", borderRadius: "8px", border: "1px solid #e2e8f0", background: "#ffffff" }}>
      <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>{label}</div>
      <div style={{ marginTop: "4px", fontSize: "0.84rem", color: "#0f172a", fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function mapProgressId(progressId: number | null): number {
  if (progressId === null || Number.isNaN(progressId)) {
    return 0;
  }

  return Math.max(0, Math.min(100, progressId));
}

function mapTimelineStep(progressId: number | null): number {
  const progress = mapProgressId(progressId);
  if (progress < 25) return 0;
  if (progress < 50) return 1;
  if (progress < 75) return 2;
  return 3;
}

function getCommandTone(status: string): "ack" | "nack" | "timeout" | "event" {
  const normalized = status.trim().toUpperCase();
  if (normalized.includes("NACK") || normalized.includes("FAIL")) {
    return "nack";
  }

  if (normalized.includes("TIMEOUT")) {
    return "timeout";
  }

  if (normalized.includes("ACK") || normalized.includes("OK") || normalized.includes("SUCCESS")) {
    return "ack";
  }

  return "event";
}

function formatHourLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function groupCommandsByHour(commands: FirmwareDeviceDiagnosticsResponse["recentCommands"]): Array<{
  hourKey: string;
  label: string;
  commands: FirmwareDeviceDiagnosticsResponse["recentCommands"];
}> {
  const buckets = new Map<string, FirmwareDeviceDiagnosticsResponse["recentCommands"]>();

  for (const command of commands) {
    const date = new Date(command.createdAt);
    const hourKey = Number.isNaN(date.getTime())
      ? "unknown"
      : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;
    const bucket = buckets.get(hourKey) ?? [];
    bucket.push(command);
    buckets.set(hourKey, bucket);
  }

  return Array.from(buckets.entries()).map(([hourKey, groupCommands]) => {
    const first = groupCommands[0];
    const firstDate = first ? new Date(first.createdAt) : new Date();
    const label = Number.isNaN(firstDate.getTime())
      ? "Unknown hour"
      : firstDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    return {
      hourKey,
      label,
      commands: groupCommands,
    };
  });
}

function snapshotToTree(snapshot: FirmwareDeviceDiagnosticsResponse["recentDebugSnapshots"][number] | null): Record<string, unknown> {
  if (!snapshot) {
    return {};
  }

  let parsedPayload: unknown = snapshot.payloadJson;
  try {
    parsedPayload = JSON.parse(snapshot.payloadJson);
  } catch {
    parsedPayload = snapshot.payloadJson;
  }

  return {
    id: snapshot.id,
    deviceId: snapshot.deviceId,
    requestId: snapshot.requestId,
    tsMs: snapshot.tsMs,
    receivedAt: snapshot.receivedAt,
    pressure0Raw: snapshot.pressure0Raw,
    pressure1Raw: snapshot.pressure1Raw,
    pressure2Raw: snapshot.pressure2Raw,
    hallRaw: snapshot.hallRaw,
    payloadJson: parsedPayload,
  };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: "grid", gap: "6px" }}>
      <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--text)" }}>{title}</div>
      <div style={{ display: "grid", gap: "6px" }}>{children}</div>
    </div>
  );
}

function CommandRow({ command }: { command: FirmwareDeviceDiagnosticsResponse["recentCommands"][number] }) {
  const tone = getCommandTone(command.status);
  const timestamp = formatHourLabel(command.createdAt);
  return (
    <div style={entryStyle} className={`diagnostics-row diagnostics-row--${tone}`}>
      <div style={entryTitleStyle}>{command.commandName}</div>
      <div style={entryMetaStyle}>{timestamp} · request_id: {command.requestId}</div>
      <div style={entryMetaStyle}>status: {command.status} | reply_status: {command.replyStatus ?? "-"}</div>
      <div style={entryMetaStyle}>reason_id: {command.reasonId ?? "-"} | action_id: {command.actionId ?? "-"}</div>
    </div>
  );
}

function EventRow({ event }: { event: FirmwareDeviceDiagnosticsResponse["recentEvents"][number] }) {
  return (
    <div style={entryStyle} className="diagnostics-row diagnostics-row--event">
      <div style={entryTitleStyle}>event_id: {event.eventId ?? "-"}</div>
      <div style={entryMetaStyle}>topic_family: {event.topicFamily}</div>
      <div style={entryMetaStyle}>state: {event.firmwareState ?? "-"} | result/status: {event.result ?? event.status ?? "-"}</div>
      <div style={entryMetaStyle}>reason_id: {event.reasonId ?? "-"} | action_id: {event.actionId ?? "-"} | progress_id: {event.progressId ?? "-"}</div>
    </div>
  );
}

function EmptyText({ text }: { text: string }) {
  return <div style={{ fontSize: "0.82rem", color: "var(--muted)" }}>{text}</div>;
}

function buttonStyle(disabled: boolean): CSSProperties {
  return {
    padding: "6px 10px",
    borderRadius: "6px",
    border: "1px solid var(--line)",
    background: disabled ? "var(--surface-soft)" : "var(--surface-strong)",
    color: disabled ? "var(--muted)" : "var(--text)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 700,
    fontSize: "0.82rem",
  };
}

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(260px, 360px) repeat(auto-fit, minmax(140px, 1fr))",
  gap: "12px",
};

const sensorPanelStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
  padding: "10px",
  borderRadius: "8px",
  border: "1px solid var(--line)",
  background: "#ffffff",
};

const sensorControlRowStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  alignItems: "end",
  flexWrap: "wrap",
};

const sensorInputLabelStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
  minWidth: "150px",
  fontSize: "0.76rem",
  fontWeight: 800,
  color: "var(--text)",
};

const sensorInputStyle: CSSProperties = {
  width: "150px",
  minHeight: "32px",
  padding: "6px 8px",
  borderRadius: "6px",
  border: "1px solid var(--line)",
  font: "inherit",
};

const sensorErrorStyle: CSSProperties = {
  margin: 0,
  color: "#b91c1c",
  fontSize: "0.82rem",
  fontWeight: 700,
};

const sensorStatusGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: "8px",
};

const sensorCardStyle: CSSProperties = {
  minHeight: "112px",
  padding: "10px",
  borderRadius: "8px",
  border: "1px solid var(--line)",
  background: "var(--surface-strong)",
  display: "grid",
  gap: "6px",
  alignContent: "start",
};

const sensorValueStyle: CSSProperties = {
  minHeight: "28px",
  fontSize: "1.1rem",
  fontWeight: 800,
  color: "var(--text)",
};

const sensorProgressTrackStyle: CSSProperties = {
  height: "8px",
  borderRadius: "999px",
  background: "#e2e8f0",
  overflow: "hidden",
};

const sensorProgressFillStyle: CSSProperties = {
  height: "100%",
  borderRadius: "999px",
  background: "#0f766e",
};

const entryStyle: CSSProperties = {
  padding: "8px",
  borderRadius: "8px",
  border: "1px solid var(--line)",
  background: "var(--surface-strong)",
};

const entryTitleStyle: CSSProperties = {
  fontSize: "0.82rem",
  fontWeight: 700,
  color: "var(--text)",
};

const entryMetaStyle: CSSProperties = {
  marginTop: "3px",
  fontSize: "0.76rem",
  color: "var(--muted)",
};

const readinessInfoRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  alignItems: "center",
  fontSize: "0.8rem",
};

const readinessInfoLabelStyle: CSSProperties = {
  color: "var(--muted)",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

const readinessInfoValueStyle: CSSProperties = {
  color: "var(--text)",
  fontWeight: 700,
};

const cubeRowStyle: CSSProperties = {
  alignItems: "flex-start",
};

const timelineTrackStyle: CSSProperties = {
  position: "relative",
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: 8,
  alignItems: "center",
  padding: "12px 10px 14px",
  borderRadius: 12,
  background: "var(--surface-soft)",
  border: "1px solid var(--line)",
  overflow: "hidden",
};

const timelineStepStyle: CSSProperties = {
  position: "relative",
  zIndex: 1,
  display: "grid",
  justifyItems: "center",
  gap: 6,
  textAlign: "center",
};
