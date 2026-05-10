import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { fetchBrowserHealth, type BrowserHealthResponse } from "../lib/browserHealthApi";
import HubHeartbeat from "../components/icons/HubHeartbeat";
import RadarManikin from "../components/icons/RadarManikin";
import CounterFlip from "../components/icons/CounterFlip";
import {
  fetchSessionLive,
  getSessionLiveStreamUrl,
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

const WAITING_SESSION_TIPS = [
  "Once a session is assigned, vital signs will appear here.",
  "Your instructor will start the scenario from their dashboard.",
  "Ensure your headset / microphone are ready for debrief.",
];

type SensorPoint = {
  ts: number;
  depthMm: number | null;
  rateCpm: number | null;
  pauseS: number | null;
  recoilOk: boolean | null;
  force1: number | null;
  force2: number | null;
  pressureBalancePct: number | null;
  pressureSkewed: boolean | null;
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

function WaitingSessionStory() {
  const [tipIndex, setTipIndex] = useState(0);
  const [placeholderSeconds, setPlaceholderSeconds] = useState(3);

  useEffect(() => {
    const tipTimer = window.setInterval(() => {
      setTipIndex((current) => (current + 1) % WAITING_SESSION_TIPS.length);
    }, 10000);

    const countdownTimer = window.setInterval(() => {
      setPlaceholderSeconds((current) => (current === 1 ? 3 : current - 1));
    }, 1300);

    return () => {
      window.clearInterval(tipTimer);
      window.clearInterval(countdownTimer);
    };
  }, []);

  return (
    <section className="waiting-session-story" aria-label="Waiting for session">
      <div className="waiting-session-story__hero">
        <div className="waiting-session-story__ring-shell" aria-hidden="true">
          <span className="waiting-session-story__ring waiting-session-story__ring--outer" />
          <span className="waiting-session-story__ring waiting-session-story__ring--inner" />
          <span className="waiting-session-story__ring waiting-session-story__ring--core" />
          <span className="waiting-session-story__glow" />
          <span className="waiting-session-story__pulse" />
          <div className="waiting-session-story__manikin">
            <RadarManikin sweep size={92} />
          </div>
        </div>

        <div className="waiting-session-story__headline-block">
          <p className="waiting-session-story__eyebrow">Waiting for session</p>
          <h3 className="waiting-session-story__title">Awaiting instructor assignment</h3>
          <div className="waiting-session-story__countdown" aria-label="Assignment placeholder">
            <span className="waiting-session-story__countdown-label">Next handoff</span>
            <span className="waiting-session-story__countdown-value">
              <CounterFlip value={placeholderSeconds} />
              <span>sec</span>
            </span>
          </div>
        </div>
      </div>

      <div className="waiting-session-story__details">
        <div className="waiting-session-story__arrow" aria-hidden="true">
          <svg viewBox="0 0 88 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 12C36 12 44 22 44 34V44" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="5 7" />
            <path d="M30 36L44 50L58 36" stroke="#1d4ed8" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Details will anchor here</span>
        </div>

        <div className="waiting-session-story__slot" aria-hidden="true">
          <div className="waiting-session-story__slot-header">
            <span className="waiting-session-story__slot-kicker">Session panel</span>
            <span className="waiting-session-story__slot-status">Idle</span>
          </div>
          <div className="waiting-session-story__slot-lines">
            <span />
            <span />
            <span className="waiting-session-story__slot-lines--short" />
          </div>
        </div>
      </div>

      <div className="waiting-session-story__tip-carousel" aria-live="polite">
        <p className="waiting-session-story__tip-label">Helpful tip</p>
        <p className="waiting-session-story__tip-copy">{WAITING_SESSION_TIPS[tipIndex]}</p>
        <div className="waiting-session-story__tip-dots" aria-hidden="true">
          {WAITING_SESSION_TIPS.map((tip, index) => (
            <span
              key={tip}
              className={`waiting-session-story__tip-dot ${index === tipIndex ? "waiting-session-story__tip-dot--active" : ""}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
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
  const [streamState, setStreamState] = useState<LiveStreamState>("connecting");
  const [streamMessage, setStreamMessage] = useState<string | null>(null);
  const [sensorHistory, setSensorHistory] = useState<SensorPoint[]>([]);

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
      setStreamState("unavailable");
      setStreamMessage(null);
      return;
    }

    const activeSessionId = sessionId;

    let isActive = true;
    let eventSource: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function appendSensorPoint(next: SessionLiveView) {
      const point: SensorPoint = {
        ts: Date.now(),
        depthMm: next.latestDepthMm,
        rateCpm: next.latestRateCpm,
        pauseS: next.latestPauseS,
        recoilOk: next.latestRecoilOk,
        force1: next.latestForce1,
        force2: next.latestForce2,
        pressureBalancePct: next.pressureBalancePct,
        pressureSkewed: next.pressureSkewed,
        flags: next.latestFlags,
      };

      setSensorHistory((previous) => [...previous, point].slice(-MAX_SENSOR_POINTS));
    }

    async function loadSession() {
      try {
        const live = await fetchSessionLive(activeSessionId);
        if (!isActive) {
          return;
        }
        setSession(live);
        if (live) {
          appendSensorPoint(live);
        }
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

    function safeParseSession(raw: string): SessionLiveView | null {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed === null || typeof parsed !== "object") {
          return null;
        }

        return parsed as SessionLiveView;
      } catch {
        return null;
      }
    }

    function connectSessionStream() {
      if (!isActive) {
        return;
      }

      if (typeof window === "undefined" || typeof window.EventSource === "undefined") {
        setStreamState("unavailable");
        setStreamMessage("Stream unavailable in this browser.");
        return;
      }

      setStreamState("connecting");
      const stream = new EventSource(getSessionLiveStreamUrl(activeSessionId), { withCredentials: true });
      eventSource = stream;

      stream.onopen = () => {
        if (!isActive) {
          return;
        }

        setStreamState("connected");
        setStreamMessage(null);
        setSessionError(null);
      };

      stream.addEventListener("session-live", (event) => {
        if (!isActive) {
          return;
        }

        const data = (event as MessageEvent<string>).data;
        if (data === "null") {
          setSession(null);
          setSessionLoading(false);
          return;
        }

        const payload = safeParseSession(data);
        if (!payload) {
          return;
        }

        setSession(payload);
        appendSensorPoint(payload);
        setSessionLoading(false);
        setSessionError(null);
      });

      stream.onerror = () => {
        if (!isActive) {
          return;
        }

        setStreamState("reconnecting");
        setStreamMessage("Live stream disconnected. Reconnecting...");

        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }

        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connectSessionStream();
          }, 2000);
        }
      };
    }

    loadSession();
    connectSessionStream();

    return () => {
      isActive = false;
      if (eventSource) {
        eventSource.close();
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
    };
  }, [sessionId]);

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
  const force1Series = sensorHistory.map((point) => point.force1);
  const force2Series = sensorHistory.map((point) => point.force2);
  const balanceSeries = sensorHistory.map((point) => point.pressureBalancePct);
  const latestBalance = sensorHistory.length > 0 ? sensorHistory[sensorHistory.length - 1].pressureBalancePct : null;
  const latestSkewed = sensorHistory.length > 0 ? sensorHistory[sensorHistory.length - 1].pressureSkewed : null;
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
          {currentUser && embeddedInDesktop ? (
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
        {/* Hub Status Card - Always visible */}
        <section style={styles.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <HubHeartbeat state={healthLoading ? "checking" : health?.ok ? "ok" : "down"} size={18} />
              <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>Hub Status</h2>
            </div>
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

        {/* Session Details Card - Only when sessionId exists and loading or session data available */}
        {sessionId && (sessionLoading || !sessionError) && (
          <section style={styles.card}>
            <h2 style={{ margin: "0 0 12px 0", fontSize: "1.1rem", fontWeight: 600 }}>Session Details</h2>
            {sessionLoading ? (
              <div style={{ background: "#f1f5f9", borderRadius: "8px", padding: "12px", minHeight: "80px", display: "flex", alignItems: "center", color: "#64748b" }}>
                Loading session details...
              </div>
            ) : session ? (
              <div style={{ display: "grid", gap: "8px" }}>
                <div>
                  <p style={{ margin: "0 0 4px 0", fontSize: "0.8rem", color: "#64748b", fontWeight: 600 }}>SCENARIO</p>
                  <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 500, color: "#0f172a" }}>
                    {session.scenario || "No scenario assigned"}
                  </p>
                </div>
                <div>
                  <p style={{ margin: "0 0 4px 0", fontSize: "0.8rem", color: "#64748b", fontWeight: 600 }}>MANIKIN</p>
                  <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 500, color: "#0f172a" }}>
                    {session.deviceId}
                  </p>
                </div>
              </div>
            ) : null}
          </section>
        )}

        {/* Live Vitals Card - Only when sessionId exists */}
        {sessionId && (
          <>
            {sessionError ? (
              <section style={styles.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", gap: "10px", flexWrap: "wrap" }}>
                  <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>Live Vitals</h2>
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
            ) : !session ? (
              <section style={styles.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", gap: "10px", flexWrap: "wrap" }}>
                  <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>Live Vitals</h2>
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
                </div>
              </section>
            ) : (
              <section style={styles.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>Live Vitals</h2>
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
                <div style={{ display: "grid", gap: "6px", marginBottom: "16px" }}>
                  <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Depth: {metric(session.latestDepthMm, "mm")}</p>
                  <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Rate: {metric(session.latestRateCpm, "cpm")}</p>
                  <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Recoil: {session.latestRecoilOk === null ? "-" : session.latestRecoilOk ? "OK" : "Not OK"}</p>
                  <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Pause: {metric(session.latestPauseS, "s")}</p>
                  <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>
                    Pressure Balance: {session.pressureBalancePct === null ? "-" : `${session.pressureBalancePct.toFixed(1)} %`}
                  </p>
                  <p style={{ margin: 0, color: session.pressureSkewed === null ? "#475569" : session.pressureSkewed ? "#991b1b" : "#166534", fontSize: "0.88rem", fontWeight: 600 }}>
                    Pressure: {session.pressureSkewed === null ? "-" : session.pressureSkewed ? "Skewed" : "Even"}
                  </p>
                  <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>
                    Force A/B: {session.latestForce1 === null || session.latestForce2 === null ? "-" : `${session.latestForce1} / ${session.latestForce2}`}
                  </p>
                  <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Device: {session.online ? "Online" : "Offline"}</p>
                </div>

                <div>
                  <h3 style={{ margin: "0 0 10px 0", fontSize: "1rem", fontWeight: 600, color: "#0f172a" }}>Sensor Trends</h3>
                  <p style={{ margin: "0 0 12px 0", fontSize: "0.83rem", color: "#64748b" }}>
                    Rolling window of last {MAX_SENSOR_POINTS} updates.
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "10px" }}>
                    <Sparkline values={depthSeries} color="#0ea5e9" label="Depth / Delta" />
                    <Sparkline values={rateSeries} color="#22c55e" label="Rate / Compression Trend" />
                    <Sparkline values={pauseSeries} color="#f97316" label="Pause" />
                    <Sparkline values={force1Series} color="#2563eb" label="Force Graph A (Bladder 1)" />
                    <Sparkline values={force2Series} color="#7c3aed" label="Force Graph B (Bladder 2)" />
                    <Sparkline values={balanceSeries} color="#0891b2" label="Pressure Balance (%)" />
                    <RecoilTimeline values={recoilSeries} />
                  </div>
                  <div style={{ marginTop: "10px", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "10px", background: "#f8fafc" }}>
                    <p style={{ margin: "0 0 6px 0", fontSize: "0.84rem", color: "#334155", fontWeight: 600 }}>
                      Live Balance: {latestBalance === null ? "-" : `${latestBalance.toFixed(1)}%`} | Status: {latestSkewed === null ? "-" : latestSkewed ? "Skewed" : "Even"}
                    </p>
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
          </>
        )}

        {/* Waiting for Session - Only when no sessionId */}
        {!sessionId && (
          <section style={styles.card}>
            <h2 style={{ margin: "0 0 12px 0", fontSize: "1.1rem", fontWeight: 600 }}>No Active Session</h2>
            <WaitingSessionStory />
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
