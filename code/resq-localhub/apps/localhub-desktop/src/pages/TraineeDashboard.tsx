import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { LiveMetricsPanel } from "../components/LiveMetricsPanel";
import { useLiveSession } from "../hooks/useLiveSession";
import { fetchBrowserHealth, type BrowserHealthResponse } from "../lib/browserHealthApi";
import {
  fetchSessionLive,
  type SessionLiveView,
} from "../lib/browserSessionsApi";

/**
 * Browser-safe Trainee Dashboard.
 *
 * This page is served at http://<host>:1420/trainee and can be opened
 * in any browser on the LAN without depending on Tauri APIs.
 */

function HealthStatusBadge({ health }: { health: BrowserHealthResponse | null }) {
  if (!health) {
    return (
      <span style={{
        display: "inline-block",
        padding: "4px 10px",
        borderRadius: "999px",
        fontSize: "0.8rem",
        fontWeight: 600,
        background: "#e2e8f0",
        color: "#334155",
      }}>
        Checking...
      </span>
    );
  }

  if (health.ok) {
    return (
      <span style={{
        display: "inline-block",
        padding: "4px 10px",
        borderRadius: "999px",
        fontSize: "0.8rem",
        fontWeight: 600,
        background: "#dcfce7",
        color: "#166534",
      }}>
        Healthy
      </span>
    );
  }

  return (
    <span style={{
      display: "inline-block",
      padding: "4px 10px",
      borderRadius: "999px",
      fontSize: "0.8rem",
      fontWeight: 600,
      background: "#fee2e2",
      color: "#991b1b",
    }}>
      Unreachable
    </span>
  );
}

function SessionStatusBadge({ active }: { active: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 10px",
        borderRadius: "999px",
        fontSize: "0.8rem",
        fontWeight: 600,
        background: active ? "#dcfce7" : "#fee2e2",
        color: active ? "#166534" : "#991b1b",
      }}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

type LiveStreamState = "connecting" | "connected" | "reconnecting" | "unavailable";

type TraineeDashboardProps = {
  embeddedInDesktop?: boolean;
  initialSessionId?: string | null;
};

type SensorPoint = {
  ts: number;
  depthMm: number | null;
  rateCpm: number | null;
  pauseS: number | null;
  recoilOk: boolean | null;
  flags: string | null;
};

const MAX_SENSOR_POINTS = 80;

function Sparkline({
  values,
  color,
  label,
}: {
  values: Array<number | null>;
  color: string;
  label: string;
}) {
  const width = 420;
  const height = 110;
  const padding = 10;
  const numeric = values.filter((value): value is number => value !== null && Number.isFinite(value));

  if (numeric.length === 0) {
    return (
      <div style={{ border: "1px solid #e2e8f0", borderRadius: "10px", padding: "10px", background: "#f8fafc" }}>
        <p style={{ margin: "0 0 6px 0", fontSize: "0.84rem", color: "#334155", fontWeight: 600 }}>{label}</p>
        <div style={{ fontSize: "0.82rem", color: "#64748b" }}>No live values yet</div>
      </div>
    );
  }

  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  const span = Math.max(1, max - min);
  const step = values.length <= 1 ? 0 : (width - padding * 2) / (values.length - 1);

  let hasPoint = false;
  let path = "";

  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value === null || !Number.isFinite(value)) {
      continue;
    }

    const x = padding + i * step;
    const normalized = (value - min) / span;
    const y = height - padding - normalized * (height - padding * 2);
    path += `${hasPoint ? " L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
    hasPoint = true;
  }

  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: "10px", padding: "10px", background: "#ffffff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "6px", gap: "8px" }}>
        <p style={{ margin: 0, fontSize: "0.84rem", color: "#334155", fontWeight: 600 }}>{label}</p>
        <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748b" }}>min {min.toFixed(1)} / max {max.toFixed(1)}</p>
      </div>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label} style={{ display: "block", height: "110px" }}>
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#e2e8f0" strokeWidth="1" />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#e2e8f0" strokeWidth="1" />
        {path ? <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /> : null}
      </svg>
    </div>
  );
}

function RecoilTimeline({ values }: { values: Array<boolean | null> }) {
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: "10px", padding: "10px", background: "#ffffff" }}>
      <p style={{ margin: "0 0 6px 0", fontSize: "0.84rem", color: "#334155", fontWeight: 600 }}>Recoil Timeline</p>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, values.length)}, minmax(0, 1fr))`, gap: "3px" }}>
        {values.map((value, index) => (
          <div
            key={`recoil-${index}`}
            style={{
              height: "12px",
              borderRadius: "3px",
              background: value === null ? "#e2e8f0" : value ? "#16a34a" : "#dc2626",
            }}
            title={value === null ? "No sample" : value ? "Recoil OK" : "Recoil Not OK"}
          />
        ))}
      </div>
      <p style={{ margin: "8px 0 0 0", fontSize: "0.76rem", color: "#64748b" }}>Green = OK, Red = Not OK, Gray = no sample</p>
    </div>
  );
}

function LiveStreamStatusBadge({ state }: { state: LiveStreamState }) {
  if (state === "connecting") {
    return (
      <span style={{ display: "inline-block", padding: "4px 10px", borderRadius: "999px", fontSize: "0.78rem", fontWeight: 600, background: "#e2e8f0", color: "#334155" }}>
        Connecting
      </span>
    );
  }

  if (state === "connected") {
    return (
      <span style={{ display: "inline-block", padding: "4px 10px", borderRadius: "999px", fontSize: "0.78rem", fontWeight: 600, background: "#dcfce7", color: "#166534" }}>
        Live stream connected
      </span>
    );
  }

  if (state === "reconnecting") {
    return (
      <span style={{ display: "inline-block", padding: "4px 10px", borderRadius: "999px", fontSize: "0.78rem", fontWeight: 600, background: "#fef3c7", color: "#92400e" }}>
        Reconnecting...
      </span>
    );
  }

  return (
    <span style={{ display: "inline-block", padding: "4px 10px", borderRadius: "999px", fontSize: "0.78rem", fontWeight: 600, background: "#fee2e2", color: "#991b1b" }}>
      Stream unavailable
    </span>
  );
}

function liveStreamStateFromConnection(state: string): LiveStreamState {
  if (state === "MQTT_WS_LIVE" || state === "BACKEND_SSE_FALLBACK" || state === "BACKEND_POLLING_DEGRADED") {
    return "connected";
  }
  if (state === "ERROR" || state === "OFFLINE") {
    return "unavailable";
  }
  if (state === "STALE") {
    return "reconnecting";
  }
  return "connecting";
}

export default function TraineeDashboard({
  embeddedInDesktop = false,
  initialSessionId = null,
}: TraineeDashboardProps) {
  const { currentUser, logout } = useAuth();
  const [health, setHealth] = useState<BrowserHealthResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<SessionLiveView | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sensorHistory, setSensorHistory] = useState<SensorPoint[]>([]);
  const liveState = useLiveSession({
    deviceId: session?.deviceId,
    sessionId,
    enabled: Boolean(sessionId && session?.deviceId && session.active),
  });
  const streamState = liveStreamStateFromConnection(liveState.connectionState);
  const streamMessage = liveState.error ?? liveState.message ?? null;

  useEffect(() => {
    if (initialSessionId && initialSessionId.trim().length > 0) {
      setSessionId(initialSessionId.trim());
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const currentSessionId = params.get("sessionId");
    setSessionId(currentSessionId && currentSessionId.trim().length > 0 ? currentSessionId.trim() : null);
  }, [initialSessionId]);

  useEffect(() => {
    setSensorHistory([]);
  }, [sessionId]);

  useEffect(() => {
    async function loadHealth() {
      setHealthLoading(true);
      const result = await fetchBrowserHealth();
      setHealth(result);
      setHealthLoading(false);
    }

    loadHealth();
    const interval = setInterval(loadHealth, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      setSessionLoading(false);
      setSessionError(null);
      return;
    }

    const activeSessionId = sessionId;
    let isActive = true;

    async function loadSession() {
      try {
        const live = await fetchSessionLive(activeSessionId);
        if (!isActive) {
          return;
        }
        setSession(live);
        setSessionError(null);
      } catch (error) {
        if (!isActive) {
          return;
        }
        setSession(null);
        setSessionError(error instanceof Error ? error.message : "Failed to load session live data.");
      } finally {
        if (isActive) {
          setSessionLoading(false);
        }
      }
    }

    loadSession();

    return () => {
      isActive = false;
    };
  }, [sessionId]);

  useEffect(() => {
    const metric = liveState.latestMetric;
    if (!metric) {
      return;
    }

    setSensorHistory((previous) => [
      ...previous,
      {
        ts: Date.now(),
        depthMm: metric.depthMm,
        rateCpm: metric.rateCpm,
        pauseS: metric.pauseS,
        recoilOk: metric.recoilOk,
        flags: Array.isArray(metric.flags) ? metric.flags.join(", ") : metric.flags,
      },
    ].slice(-MAX_SENSOR_POINTS));
  }, [
    liveState.latestMetric?.seq,
    liveState.latestMetric?.timestamp,
    liveState.latestMetric?.tsMs,
    liveState.latestMetric?.compressionCount,
  ]);

  function metric(value: number | null, suffix: string): string {
    if (value === null || value === undefined) {
      return "-";
    }

    return `${value.toFixed(1)} ${suffix}`;
  }

  function formatTime(value: string | null): string {
    if (!value) {
      return "-";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleTimeString();
  }

  function navigateToInstructorDashboard() {
    window.location.assign("/instructor");
  }

  function navigateToDesktopHome() {
    window.location.assign("/");
  }

  const depthSeries = sensorHistory.map((point) => point.depthMm);
  const rateSeries = sensorHistory.map((point) => point.rateCpm);
  const pauseSeries = sensorHistory.map((point) => point.pauseS);
  const recoilSeries = sensorHistory.map((point) => point.recoilOk);
  const recentFlags = sensorHistory
    .map((point) => point.flags)
    .filter((value): value is string => Boolean(value && value.trim()))
    .slice(-8)
    .reverse();

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <div>
            <h1 style={styles.title}>Trainee Dashboard</h1>
            <p style={styles.subtitle}>
              Assigned manikin live performance for one active session
            </p>
          </div>
          {currentUser ? (
            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ padding: "6px 10px", borderRadius: "999px", background: "#e2e8f0", color: "#334155", fontSize: "0.8rem", fontWeight: 700 }}>
                {currentUser.role}
              </span>
              <button
                type="button"
                onClick={() => {
                  logout().finally(() => window.location.assign("/login"));
                }}
                style={{
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  color: "#0f172a",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Logout
              </button>
            </div>
          ) : null}
          {!embeddedInDesktop ? (
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
              {currentUser?.role !== "TRAINEE" ? (
                <button
                  type="button"
                  onClick={navigateToInstructorDashboard}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid #0f172a",
                    background: "#0f172a",
                    color: "#ffffff",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Back To Instructor
                </button>
              ) : null}
              <button
                type="button"
                onClick={navigateToDesktopHome}
                style={{
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  color: "#0f172a",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Back To Home
              </button>
              {currentUser ? (
                <>
                  <span style={{ padding: "6px 10px", borderRadius: "999px", background: "#e2e8f0", color: "#334155", fontSize: "0.8rem", fontWeight: 700 }}>
                    {currentUser.role}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      logout().finally(() => window.location.assign("/login"));
                    }}
                    style={{
                      padding: "8px 12px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      background: "#ffffff",
                      color: "#0f172a",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Logout
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      <div style={styles.content}>
        <section style={styles.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>Hub Status</h2>
            <HealthStatusBadge health={healthLoading ? null : health} />
          </div>
          <p style={{ margin: 0, color: "#64748b", fontSize: "0.9rem" }}>
            {healthLoading
              ? "Checking hub connectivity..."
              : health?.ok
                ? "Backend is running and responding to health checks."
                : "Unable to reach the hub backend. Check that the API service is running."}
          </p>
          {health?.timestamp && (
            <p style={{ margin: "8px 0 0 0", color: "#9ca3af", fontSize: "0.8rem" }}>
              Last update: {new Date(health.timestamp).toLocaleTimeString()}
            </p>
          )}
        </section>

        {!sessionId ? (
          <section style={styles.card}>
            <h2 style={{ margin: "0 0 12px 0", fontSize: "1.1rem", fontWeight: 600 }}>No Active Session</h2>
            <div style={{ padding: "20px", borderRadius: "8px", background: "#f8fafc", border: "1px dashed #cbd5e1" }}>
              <p style={{ margin: 0, color: "#64748b", fontSize: "0.92rem" }}>
                No active session selected yet.
              </p>
              <p style={{ margin: "8px 0 0 0", color: "#94a3b8", fontSize: "0.85rem" }}>
                Open a trainee link like /trainee?sessionId=&lt;id&gt; from the instructor dashboard.
              </p>
            </div>
          </section>
        ) : sessionError ? (
          <section style={styles.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", gap: "10px", flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>Session Error</h2>
              <LiveStreamStatusBadge state={streamState} />
            </div>
            <div style={{ padding: "20px", borderRadius: "8px", background: "#fef2f2", border: "1px solid #fecaca" }}>
              <p style={{ margin: 0, color: "#991b1b", fontSize: "0.92rem" }}>
                {sessionError}
              </p>
              {streamMessage ? (
                <p style={{ margin: "8px 0 0 0", color: "#b45309", fontSize: "0.86rem" }}>
                  {streamMessage}
                </p>
              ) : null}
            </div>
          </section>
        ) : sessionLoading ? (
          <section style={styles.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", gap: "10px", flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>Active Session Live View</h2>
              <LiveStreamStatusBadge state={streamState} />
            </div>
            <p style={{ margin: 0, color: "#64748b", fontSize: "0.92rem" }}>Loading session data...</p>
          </section>
        ) : !session ? (
          <section style={styles.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", gap: "10px", flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>Session Ended</h2>
              <LiveStreamStatusBadge state={streamState} />
            </div>
            <div style={{ padding: "20px", borderRadius: "8px", background: "#f8fafc", border: "1px solid #e2e8f0" }}>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.92rem" }}>
                Session {sessionId} is no longer active.
              </p>
              {streamMessage ? (
                <p style={{ margin: "8px 0 0 0", color: "#b45309", fontSize: "0.86rem" }}>
                  {streamMessage}
                </p>
              ) : null}
              <p style={{ margin: "8px 0 0 0", color: "#94a3b8", fontSize: "0.85rem" }}>
                The instructor can still view and export the completed summary.
              </p>
            </div>
          </section>
        ) : (
          <section style={styles.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>Active Session Live View</h2>
              <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                <LiveStreamStatusBadge state={streamState} />
                <SessionStatusBadge active={Boolean(session?.active)} />
              </div>
            </div>
            {streamMessage ? (
              <p style={{ margin: "0 0 8px 0", color: "#b45309", fontSize: "0.86rem" }}>
                {streamMessage}
              </p>
            ) : null}
            <div style={{ display: "grid", gap: "6px" }}>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Session: {session.sessionId}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Device: {session.deviceId}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Trainee: {session.traineeId ?? "-"}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>State: {session.state ?? "unknown"}</p>
              <p style={{ margin: 0, color: session.online ? "#166534" : "#991b1b", fontSize: "0.88rem", fontWeight: 600 }}>
                Device: {session.online ? "Online" : "Offline"}
              </p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Started: {formatTime(session.startedAt)}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Last Backend Snapshot: {formatTime(session.lastSeen)}</p>
            </div>

            <div style={{ marginTop: "14px" }}>
              <LiveMetricsPanel state={liveState} title="Your Live Feedback" traineeFriendly />
            </div>

            <div style={{ marginTop: "16px" }}>
              <h3 style={{ margin: "0 0 10px 0", fontSize: "1rem", fontWeight: 600, color: "#0f172a" }}>Live Sensor Plots</h3>
              <p style={{ margin: "0 0 12px 0", fontSize: "0.83rem", color: "#64748b" }}>
                Rolling window of last {MAX_SENSOR_POINTS} updates. Use this to quickly confirm sensor behavior.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "10px" }}>
                <Sparkline values={depthSeries} color="#0ea5e9" label="Depth" />
                <Sparkline values={rateSeries} color="#22c55e" label="Rate" />
                <Sparkline values={pauseSeries} color="#f97316" label="Pause" />
                <RecoilTimeline values={recoilSeries} />
              </div>
              <div style={{ marginTop: "10px", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "10px", background: "#f8fafc" }}>
                <p style={{ margin: "0 0 6px 0", fontSize: "0.84rem", color: "#334155", fontWeight: 600 }}>Recent Flags / Feedback</p>
                {recentFlags.length === 0 ? (
                  <p style={{ margin: 0, fontSize: "0.82rem", color: "#64748b" }}>No feedback flags yet</p>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {recentFlags.map((flag, index) => (
                      <span
                        key={`${flag}-${index}`}
                        style={{
                          padding: "4px 8px",
                          borderRadius: "999px",
                          fontSize: "0.78rem",
                          fontWeight: 600,
                          background: "#e2e8f0",
                          color: "#334155",
                        }}
                      >
                        {flag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: "Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif",
    padding: "32px 24px",
    color: "#0f172a",
    background: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)",
    minHeight: "100vh",
  },
  header: {
    marginBottom: "24px",
    paddingBottom: "16px",
    borderBottom: "1px solid #e5e7eb",
  },
  title: {
    margin: 0,
    fontSize: "1.75rem",
    fontWeight: 700,
    letterSpacing: "-0.02em",
  },
  subtitle: {
    margin: "8px 0 0 0",
    color: "#64748b",
    fontSize: "0.95rem",
    fontWeight: 400,
  },
  content: {
    display: "grid",
    gap: "16px",
  },
  card: {
    background: "#ffffff",
    borderRadius: "12px",
    border: "1px solid #e5e7eb",
    padding: "18px",
    boxShadow: "0 1px 3px rgba(15, 23, 42, 0.08), 0 8px 24px rgba(15, 23, 42, 0.04)",
  },
};
