import { useEffect, useState } from "react";
import { fetchBrowserHealth, type BrowserHealthResponse } from "../lib/browserHealthApi";
import { fetchSessionLive, type SessionLiveView } from "../lib/browserSessionsApi";

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

export default function TraineeDashboard() {
  const [health, setHealth] = useState<BrowserHealthResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<SessionLiveView | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const currentSessionId = params.get("sessionId");
    setSessionId(currentSessionId && currentSessionId.trim().length > 0 ? currentSessionId.trim() : null);
  }, []);

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
    const interval = setInterval(loadSession, 1500);

    return () => {
      isActive = false;
      clearInterval(interval);
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

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>Trainee Dashboard</h1>
        <p style={styles.subtitle}>
          Assigned manikin live performance for one active session
        </p>
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
            <h2 style={{ margin: "0 0 12px 0", fontSize: "1.1rem", fontWeight: 600 }}>Session Error</h2>
            <div style={{ padding: "20px", borderRadius: "8px", background: "#fef2f2", border: "1px solid #fecaca" }}>
              <p style={{ margin: 0, color: "#991b1b", fontSize: "0.92rem" }}>
                {sessionError}
              </p>
            </div>
          </section>
        ) : sessionLoading ? (
          <section style={styles.card}>
            <h2 style={{ margin: "0 0 12px 0", fontSize: "1.1rem", fontWeight: 600 }}>Active Session Live View</h2>
            <p style={{ margin: 0, color: "#64748b", fontSize: "0.92rem" }}>Loading session data...</p>
          </section>
        ) : !session ? (
          <section style={styles.card}>
            <h2 style={{ margin: "0 0 12px 0", fontSize: "1.1rem", fontWeight: 600 }}>Session Ended</h2>
            <div style={{ padding: "20px", borderRadius: "8px", background: "#f8fafc", border: "1px solid #e2e8f0" }}>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.92rem" }}>
                Session {sessionId} is no longer active.
              </p>
              <p style={{ margin: "8px 0 0 0", color: "#94a3b8", fontSize: "0.85rem" }}>
                The instructor can still view and export the completed summary.
              </p>
            </div>
          </section>
        ) : (
          <section style={styles.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>Active Session Live View</h2>
              <SessionStatusBadge active={Boolean(session?.active)} />
            </div>
            <div style={{ display: "grid", gap: "6px" }}>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Session: {session.sessionId}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Device: {session.deviceId}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Trainee: {session.traineeId ?? "-"}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>State: {session.state ?? "unknown"}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Started: {formatTime(session.startedAt)}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Last Seen: {formatTime(session.lastSeen)}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Depth: {metric(session.latestDepthMm, "mm")}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Rate: {metric(session.latestRateCpm, "cpm")}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Recoil: {session.latestRecoilOk === null ? "-" : session.latestRecoilOk ? "OK" : "Not OK"}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Pause: {metric(session.latestPauseS, "s")}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Last Event: {session.lastEventType ?? "-"}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Flags: {session.latestFlags ?? "-"}</p>
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
