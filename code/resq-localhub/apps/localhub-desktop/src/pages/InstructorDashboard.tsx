import { useEffect, useMemo, useState } from "react";
import { fetchBrowserHealth, type BrowserHealthResponse } from "../lib/browserHealthApi";
import { fetchLiveManikins, type ManikinLiveSummary } from "../lib/browserManikinsApi";
import {
  endSession,
  fetchCompletedSessions,
  getSessionCsvExportUrl,
  getSessionJsonExportUrl,
  startSession,
  type CompletedSession,
  type SessionStartResponse,
} from "../lib/browserSessionsApi";

/**
 * Browser-safe Instructor Dashboard.
 *
 * This page is served at http://<host>:1420/instructor and can be opened
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

function SessionStateBadge({ active }: { active: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 10px",
        borderRadius: "999px",
        fontSize: "0.76rem",
        fontWeight: 700,
        background: active ? "#dbeafe" : "#e2e8f0",
        color: active ? "#1d4ed8" : "#334155",
      }}
    >
      {active ? "In Session" : "Idle"}
    </span>
  );
}

type SessionActionState = "idle" | "starting" | "ending";

export default function InstructorDashboard() {
  const [health, setHealth] = useState<BrowserHealthResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [manikinsLoading, setManikinsLoading] = useState(true);
  const [manikinsError, setManikinsError] = useState<string | null>(null);
  const [manikins, setManikins] = useState<ManikinLiveSummary[]>([]);
  const [sessionDrafts, setSessionDrafts] = useState<Record<string, string>>({});
  const [sessionCache, setSessionCache] = useState<Record<string, SessionStartResponse>>({});
  const [sessionActionByDevice, setSessionActionByDevice] = useState<Record<string, SessionActionState>>({});
  const [sessionMessageByDevice, setSessionMessageByDevice] = useState<Record<string, string | null>>({});
  const [recentSessions, setRecentSessions] = useState<CompletedSession[]>([]);
  const [recentSessionsLoading, setRecentSessionsLoading] = useState(true);
  const [recentSessionsError, setRecentSessionsError] = useState<string | null>(null);
  const [latestEndedSession, setLatestEndedSession] = useState<CompletedSession | null>(null);

  useEffect(() => {
    async function loadHealth() {
      setHealthLoading(true);
      const result = await fetchBrowserHealth();
      setHealth(result);
      setHealthLoading(false);
    }

    async function loadManikins() {
      try {
        const live = await fetchLiveManikins();
        setManikins(live);
        setManikinsError(null);
        setSessionDrafts((current) => {
          const next = { ...current };
          for (const manikin of live) {
            if (!next[manikin.deviceId]) {
              next[manikin.deviceId] = manikin.activeTraineeId ?? `trainee-${manikin.deviceId.toLowerCase()}`;
            }
          }
          return next;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to fetch live manikins.";
        setManikinsError(message);
      } finally {
        setManikinsLoading(false);
      }
    }

    async function loadRecentSessions() {
      try {
        const sessions = await fetchCompletedSessions();
        setRecentSessions(sessions);
        setRecentSessionsError(null);
      } catch (error) {
        setRecentSessionsError(error instanceof Error ? error.message : "Failed to load completed sessions.");
      } finally {
        setRecentSessionsLoading(false);
      }
    }

    loadHealth();
    loadManikins();
    loadRecentSessions();

    const healthInterval = setInterval(loadHealth, 5000);
    const manikinsInterval = setInterval(loadManikins, 1500);
    const recentSessionsInterval = setInterval(loadRecentSessions, 10000);

    return () => {
      clearInterval(healthInterval);
      clearInterval(manikinsInterval);
      clearInterval(recentSessionsInterval);
    };
  }, []);

  const manikinByDeviceId = useMemo(() => {
    return new Map(manikins.map((manikin) => [manikin.deviceId, manikin]));
  }, [manikins]);

  function formatLastSeen(value: string | null): string {
    if (!value) {
      return "No messages yet";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleTimeString();
  }

  function metric(value: number | null, suffix: string): string {
    if (value === null || value === undefined) {
      return "-";
    }

    return `${value.toFixed(1)} ${suffix}`;
  }

  function buildTraineeUrl(sessionId: string): string {
    return `${window.location.origin}/trainee?sessionId=${encodeURIComponent(sessionId)}`;
  }

  function formatSummaryTime(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString();
  }

  function formatMetric(value: number, suffix: string): string {
    return `${value.toFixed(1)} ${suffix}`;
  }

  function getEffectiveSession(deviceId: string, manikin: ManikinLiveSummary): SessionStartResponse | null {
    const fromBackend = manikin.activeSessionId
      ? {
          sessionId: manikin.activeSessionId,
          deviceId: manikin.deviceId,
          traineeId: manikin.activeTraineeId,
          startedAt: manikin.activeSessionStartedAt ?? new Date().toISOString(),
          active: true,
          scenario: manikin.activeSessionScenario,
          notes: null,
        }
      : null;

    return fromBackend ?? sessionCache[deviceId] ?? null;
  }

  async function handleStartSession(deviceId: string) {
    const manikin = manikinByDeviceId.get(deviceId);
    if (!manikin) {
      return;
    }

    const traineeId = sessionDrafts[deviceId]?.trim() || `trainee-${deviceId.toLowerCase()}`;
    setSessionActionByDevice((current) => ({ ...current, [deviceId]: "starting" }));
    setSessionMessageByDevice((current) => ({ ...current, [deviceId]: null }));

    try {
      const response = await startSession({
        deviceId,
        traineeId,
        scenario: manikin.activeSessionScenario ?? null,
        notes: null,
      });
      setSessionCache((current) => ({ ...current, [deviceId]: response }));
      setSessionDrafts((current) => ({ ...current, [deviceId]: traineeId }));
      setSessionMessageByDevice((current) => ({
        ...current,
        [deviceId]: `Started session ${response.sessionId} for ${deviceId}`,
      }));
    } catch (error) {
      setSessionMessageByDevice((current) => ({
        ...current,
        [deviceId]: error instanceof Error ? error.message : "Failed to start session.",
      }));
    } finally {
      setSessionActionByDevice((current) => ({ ...current, [deviceId]: "idle" }));
    }
  }

  async function handleEndSession(deviceId: string, sessionId: string) {
    setSessionActionByDevice((current) => ({ ...current, [deviceId]: "ending" }));
    setSessionMessageByDevice((current) => ({ ...current, [deviceId]: null }));

    try {
      const response = await endSession({ sessionId });
      setLatestEndedSession(response);
      setSessionCache((current) => {
        const next = { ...current };
        delete next[deviceId];
        return next;
      });
      setRecentSessions((current) => [response, ...current.filter((session) => session.sessionId !== response.sessionId)]);
      setSessionMessageByDevice((current) => ({
        ...current,
        [deviceId]: `Ended session ${sessionId}`,
      }));
    } catch (error) {
      setSessionMessageByDevice((current) => ({
        ...current,
        [deviceId]: error instanceof Error ? error.message : "Failed to end session.",
      }));
    } finally {
      setSessionActionByDevice((current) => ({ ...current, [deviceId]: "idle" }));
    }
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>Instructor Dashboard</h1>
        <p style={styles.subtitle}>
          Multi-manikin live performance monitoring and control
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

        <section style={styles.card}>
          <h2 style={{ margin: "0 0 12px 0", fontSize: "1.1rem", fontWeight: 600 }}>Completed Session Summary</h2>
          {latestEndedSession ? (
            <div style={{ display: "grid", gap: "8px" }}>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Session: {latestEndedSession.sessionId}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Device: {latestEndedSession.deviceId}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Trainee: {latestEndedSession.traineeId ?? "-"}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Started: {formatSummaryTime(latestEndedSession.startedAt)}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Ended: {formatSummaryTime(latestEndedSession.endedAt)}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Duration: {latestEndedSession.summary.durationSeconds}s</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Avg depth: {formatMetric(latestEndedSession.summary.avgDepthMm, "mm")}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Avg rate: {formatMetric(latestEndedSession.summary.avgRateCpm, "cpm")}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Recoil: {formatMetric(latestEndedSession.summary.recoilPct, "%")}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Pauses: {latestEndedSession.summary.pausesCount}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Score: {latestEndedSession.summary.score}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Flags: {latestEndedSession.summary.latestFlags ?? "-"}</p>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <a href={getSessionJsonExportUrl(latestEndedSession.sessionId)} style={linkButtonStyle}>
                  Download JSON
                </a>
                <a href={getSessionCsvExportUrl(latestEndedSession.sessionId)} style={linkButtonStyle}>
                  Download CSV
                </a>
              </div>
            </div>
          ) : (
            <p style={{ margin: 0, color: "#64748b", fontSize: "0.92rem" }}>End a session to see the summary here.</p>
          )}
        </section>

        <section style={styles.card}>
          <h2 style={{ margin: "0 0 12px 0", fontSize: "1.1rem", fontWeight: 600 }}>Recent Sessions</h2>
          {recentSessionsLoading ? (
            <p style={{ margin: 0, color: "#64748b", fontSize: "0.92rem" }}>Loading completed sessions...</p>
          ) : recentSessionsError ? (
            <p style={{ margin: 0, color: "#b91c1c", fontSize: "0.92rem" }}>{recentSessionsError}</p>
          ) : recentSessions.length === 0 ? (
            <p style={{ margin: 0, color: "#64748b", fontSize: "0.92rem" }}>No completed sessions yet.</p>
          ) : (
            <div style={{ display: "grid", gap: "10px" }}>
              {recentSessions.map((session) => (
                <article key={session.sessionId} style={{ padding: "12px", border: "1px solid #e2e8f0", borderRadius: "10px", background: "#ffffff" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                    <div>
                      <p style={{ margin: 0, fontWeight: 600, color: "#0f172a" }}>{session.deviceId}</p>
                      <p style={{ margin: "4px 0 0 0", color: "#64748b", fontSize: "0.85rem" }}>{session.sessionId}</p>
                    </div>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      <a href={getSessionJsonExportUrl(session.sessionId)} style={linkButtonStyle}>
                        JSON
                      </a>
                      <a href={getSessionCsvExportUrl(session.sessionId)} style={linkButtonStyle}>
                        CSV
                      </a>
                    </div>
                  </div>
                  <div style={{ marginTop: "8px", display: "grid", gap: "4px" }}>
                    <p style={{ margin: 0, color: "#475569", fontSize: "0.85rem" }}>
                      Duration {session.summary.durationSeconds}s | Score {session.summary.score} | Depth {formatMetric(session.summary.avgDepthMm, "mm")}
                    </p>
                    <p style={{ margin: 0, color: "#475569", fontSize: "0.85rem" }}>
                      Rate {formatMetric(session.summary.avgRateCpm, "cpm")} | Recoil {formatMetric(session.summary.recoilPct, "%")} | Pauses {session.summary.pausesCount}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section style={styles.card}>
          <h2 style={{ margin: "0 0 12px 0", fontSize: "1.1rem", fontWeight: 600 }}>Live Manikins</h2>
          {manikinsLoading ? (
            <p style={{ margin: 0, color: "#64748b", fontSize: "0.92rem" }}>Loading live manikin data...</p>
          ) : null}

          {!manikinsLoading && manikinsError ? (
            <p style={{ margin: 0, color: "#b91c1c", fontSize: "0.92rem" }}>
              Unable to load live manikins. {manikinsError}
            </p>
          ) : null}

          {!manikinsLoading && !manikinsError && manikins.length === 0 ? (
            <div
              style={{
                padding: "20px",
                borderRadius: "8px",
                border: "1px dashed #cbd5e1",
                background: "#f8fafc",
                textAlign: "center",
                color: "#64748b",
              }}
            >
              No manikins publishing yet. Start publishing to resq/manikins/&lt;deviceId&gt;/status, heartbeat, telemetry, events, or live.
            </div>
          ) : null}

          {!manikinsLoading && !manikinsError && manikins.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "10px" }}>
              {manikins.map((manikin) => {
                const activeSession = getEffectiveSession(manikin.deviceId, manikin);
                const active = Boolean(activeSession?.sessionId);
                const traineeLink = activeSession?.sessionId ? buildTraineeUrl(activeSession.sessionId) : null;
                const actionState = sessionActionByDevice[manikin.deviceId] ?? "idle";

                return (
                  <article
                    key={manikin.deviceId}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: "10px",
                      padding: "12px",
                      background: "#ffffff",
                      display: "grid",
                      gap: "8px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
                      <h3 style={{ margin: 0, fontSize: "1rem" }}>{manikin.deviceId}</h3>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <span
                          style={{
                            fontSize: "0.76rem",
                            fontWeight: 700,
                            borderRadius: "999px",
                            padding: "3px 8px",
                            background: manikin.online ? "#dcfce7" : "#fee2e2",
                            color: manikin.online ? "#166534" : "#991b1b",
                          }}
                        >
                          {manikin.online ? "Online" : "Offline"}
                        </span>
                        <SessionStateBadge active={active} />
                      </div>
                    </div>

                    <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>State: {manikin.state ?? "unknown"}</p>
                    <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Depth: {metric(manikin.latestDepthMm, "mm")}</p>
                    <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Rate: {metric(manikin.latestRateCpm, "cpm")}</p>
                    <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>
                      Recoil: {manikin.latestRecoilOk === null ? "-" : manikin.latestRecoilOk ? "OK" : "Not OK"}
                    </p>
                    <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Pause: {metric(manikin.latestPauseS, "s")}</p>
                    <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>
                      Last Seen: {formatLastSeen(manikin.lastSeen)}
                    </p>
                    <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>
                      Last Event: {manikin.lastEventType ?? "-"}
                    </p>

                    <label style={{ display: "grid", gap: "4px", fontSize: "0.85rem", color: "#334155" }}>
                      Trainee ID
                      <input
                        type="text"
                        value={sessionDrafts[manikin.deviceId] ?? `trainee-${manikin.deviceId.toLowerCase()}`}
                        onChange={(event) =>
                          setSessionDrafts((current) => ({
                            ...current,
                            [manikin.deviceId]: event.target.value,
                          }))
                        }
                        placeholder="trainee-1"
                        style={{
                          padding: "8px 10px",
                          borderRadius: "6px",
                          border: "1px solid #cbd5e1",
                          fontFamily: "inherit",
                        }}
                      />
                    </label>

                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      {!active ? (
                        <button
                          type="button"
                          onClick={() => handleStartSession(manikin.deviceId)}
                          disabled={actionState !== "idle"}
                          style={{
                            padding: "8px 12px",
                            borderRadius: "6px",
                            border: "1px solid #0f172a",
                            background: actionState !== "idle" ? "#e2e8f0" : "#0f172a",
                            color: actionState !== "idle" ? "#64748b" : "#ffffff",
                            cursor: actionState !== "idle" ? "not-allowed" : "pointer",
                            fontWeight: 600,
                          }}
                        >
                          Start Session
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleEndSession(manikin.deviceId, activeSession!.sessionId)}
                          disabled={actionState !== "idle"}
                          style={{
                            padding: "8px 12px",
                            borderRadius: "6px",
                            border: "1px solid #991b1b",
                            background: actionState !== "idle" ? "#e2e8f0" : "#991b1b",
                            color: actionState !== "idle" ? "#64748b" : "#ffffff",
                            cursor: actionState !== "idle" ? "not-allowed" : "pointer",
                            fontWeight: 600,
                          }}
                        >
                          End Session
                        </button>
                      )}
                    </div>

                    {active && traineeLink ? (
                      <div style={{ display: "grid", gap: "4px", background: "#f8fafc", borderRadius: "8px", padding: "10px" }}>
                        <p style={{ margin: 0, fontSize: "0.85rem", color: "#334155" }}>
                          Session: {activeSession!.sessionId}
                        </p>
                        <p style={{ margin: 0, fontSize: "0.85rem", color: "#334155" }}>
                          Trainee: {activeSession!.traineeId ?? "-"}
                        </p>
                        <p style={{ margin: 0, fontSize: "0.85rem", color: "#334155", wordBreak: "break-all" }}>
                          Trainee Link: {traineeLink}
                        </p>
                      </div>
                    ) : null}

                    {sessionMessageByDevice[manikin.deviceId] ? (
                      <p style={{ margin: 0, color: "#475569", fontSize: "0.84rem" }}>
                        {sessionMessageByDevice[manikin.deviceId]}
                      </p>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>
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

const linkButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "8px 12px",
  borderRadius: "6px",
  border: "1px solid #cbd5e1",
  background: "#f8fafc",
  color: "#0f172a",
  textDecoration: "none",
  fontWeight: 600,
  fontSize: "0.85rem",
};
