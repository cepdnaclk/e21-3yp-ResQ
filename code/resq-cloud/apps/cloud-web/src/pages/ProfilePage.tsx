import { useEffect, useState } from "react";
import {
  fetchMySessionSummaries,
  type CloudSessionSummaryRecord,
  type CloudUser,
} from "../api/cloudApi";
import { ErrorState, LoadingState } from "../components/AsyncState";
import { formatDate, formatDuration, formatNumber } from "../lib/format";
import { navigate } from "../router";

// Generic path-based field extractor
function getField<T>(record: any, paths: string[], type: "number" | "string" | "boolean"): T | null {
  for (const path of paths) {
    const parts = path.split(".");
    let current = record;
    for (const part of parts) {
      current = current?.[part];
    }
    if (current !== undefined && current !== null) {
      if (typeof current === type) {
        return current as unknown as T;
      }
      if (type === "number" && !isNaN(Number(current))) {
        return Number(current) as unknown as T;
      }
    }
  }
  return null;
}

function getScore(record: any): number | null {
  return getField<number>(
    record,
    ["score", "summary.score", "metrics.score", "sourcePayload.summary.score", "payload.summary.score", "payload.score"],
    "number"
  );
}

function getDurationSeconds(record: any): number | null {
  const val = getField<number>(
    record,
    ["payload.durationMs", "durationMs", "payload.durationSeconds", "durationSeconds", "payload.summary.durationMs", "summary.durationMs"],
    "number"
  );
  if (val === null) return null;
  // Convert milliseconds to seconds
  return val > 1000 ? val / 1000 : val;
}

function getAvgRateCpm(record: any): number | null {
  return getField<number>(
    record,
    ["payload.avgRateCpm", "avgRateCpm", "payload.summary.avgRateCpm", "summary.avgRateCpm", "metrics.avgRateCpm"],
    "number"
  );
}

function getAvgDepthMm(record: any): number | null {
  return getField<number>(
    record,
    ["payload.avgDepthMm", "avgDepthMm", "payload.summary.avgDepthMm", "summary.avgDepthMm", "metrics.avgDepthMm"],
    "number"
  );
}

function getTotalCompressions(record: any): number | null {
  return getField<number>(
    record,
    ["payload.totalCompressions", "totalCompressions", "payload.summary.totalCompressions", "summary.totalCompressions"],
    "number"
  );
}

function getScenario(record: any): string | null {
  return getField<string>(
    record,
    ["payload.scenario", "scenario", "payload.summary.scenario", "summary.scenario"],
    "string"
  );
}

function getBestDate(record: any): Date | null {
  const candidates = [
    getField<string>(record, ["payload.endedAt", "endedAt", "payload.summary.endedAt", "summary.endedAt"], "string"),
    getField<string>(record, ["payload.startedAt", "startedAt", "payload.summary.startedAt", "summary.startedAt"], "string"),
    getField<string>(record, ["createdAt"], "string"),
    getField<string>(record, ["syncedAt"], "string"),
  ];
  for (const c of candidates) {
    if (c) {
      const parsed = new Date(c);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  }
  return null;
}

export function ProfilePage({ user }: { user: CloudUser }) {
  const [sessions, setSessions] = useState<CloudSessionSummaryRecord[]>([]);
  const [loading, setLoading] = useState(user.role === "TRAINEE");
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const summaries = await fetchMySessionSummaries();
      // Sort newest first using best available date
      const sorted = summaries.sort((a, b) => {
        const dateA = getBestDate(a)?.getTime() || 0;
        const dateB = getBestDate(b)?.getTime() || 0;
        return dateB - dateA;
      });
      setSessions(sorted);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load trainee training history.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user.role === "TRAINEE") {
      void loadData();
    }
  }, [user.role]);

  if (user.role === "TRAINEE") {
    if (loading) {
      return <LoadingState message="Loading your training history..." />;
    }

    if (error) {
      return (
        <section className="page-section">
          <div className="page-heading">
            <div>
              <p className="eyebrow">Account</p>
              <h2>{user.displayName}</h2>
              <p>{user.email || "No email recorded"}</p>
            </div>
            <span className="role-badge large-badge">{user.role}</span>
          </div>
          <ErrorState message={error} onRetry={() => void loadData()} />
        </section>
      );
    }

    // KPI Summary calculations
    const totalCount = sessions.length;
    const scores = sessions.map(getScore).filter((s): s is number => s !== null);
    const bestScore = scores.length > 0 ? Math.max(...scores) : null;
    const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    const latestScore = sessions.length > 0 ? getScore(sessions[0]) : null;

    const rates = sessions.map(getAvgRateCpm).filter((r): r is number => r !== null);
    const avgRate = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : null;

    const depths = sessions.map(getAvgDepthMm).filter((d): d is number => d !== null);
    const avgDepth = depths.length > 0 ? depths.reduce((a, b) => a + b, 0) / depths.length : null;

    const latestDate = sessions.length > 0 ? getBestDate(sessions[0]) : null;
    const lastTrainingDateStr = latestDate ? formatDate(latestDate.toISOString()) : "Unknown date";

    const recentSessions = sessions.slice(0, 5);

    return (
      <section className="page-section">
        {/* Welcome Card */}
        <div className="page-heading">
          <div>
            <p className="eyebrow">Trainee Dashboard</p>
            <h2>Welcome back, {user.displayName}</h2>
            <p>{user.email || "No email recorded"} | Your synced CPR training history</p>
          </div>
          <span className="role-badge large-badge">{user.role}</span>
        </div>

        {/* KPI Cards */}
        <div
          className="analytics-grid"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "16px",
            marginBottom: "12px",
          }}
        >
          <div className="metric-card">
            <p>Total Sessions</p>
            <strong>{totalCount}</strong>
            <span>All completed runs</span>
          </div>
          <div className="metric-card">
            <p>Best Score</p>
            <strong>{bestScore !== null ? formatNumber(bestScore, 0) : "—"}</strong>
            <span>Top CPR accuracy</span>
          </div>
          <div className="metric-card">
            <p>Latest Score</p>
            <strong>{latestScore !== null ? formatNumber(latestScore, 0) : "—"}</strong>
            <span>Last completed run</span>
          </div>
          <div className="metric-card">
            <p>Average Score</p>
            <strong>{avgScore !== null ? formatNumber(avgScore, 1) : "—"}</strong>
            <span>Cumulative performance</span>
          </div>
          <div className="metric-card">
            <p>Average Rate</p>
            <strong>{avgRate !== null ? `${formatNumber(avgRate, 1)} cpm` : "—"}</strong>
            <span>Compression speed</span>
          </div>
          <div className="metric-card">
            <p>Average Depth</p>
            <strong>{avgDepth !== null ? `${formatNumber(avgDepth, 1)} mm` : "—"}</strong>
            <span>Compression depth</span>
          </div>
          <div className="metric-card">
            <p>Last Session</p>
            <strong style={{ fontSize: "1.5rem", marginTop: "24px" }}>
              {lastTrainingDateStr}
            </strong>
            <span>Last training date</span>
          </div>
        </div>

        {/* Recent Sessions List */}
        <div>
          <h3 style={{ margin: "24px 0 12px", fontSize: "1.25rem", color: "var(--brand-dark)" }}>
            Recent Sessions
          </h3>
          
          {sessions.length === 0 ? (
            <div className="state-panel">
              <div>
                <h2>No synced training sessions yet</h2>
                <p>Complete a LocalHub session and sync it to cloud to see your history here.</p>
              </div>
            </div>
          ) : (
            <div className="table-card">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Scenario</th>
                      <th>Score</th>
                      <th>Duration</th>
                      <th>Compressions</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentSessions.map((record) => {
                      const dateObj = getBestDate(record);
                      const dateStr = dateObj ? formatDate(dateObj.toISOString()) : "Unknown date";
                      const durationSec = getDurationSeconds(record);
                      const compressions = getTotalCompressions(record);
                      const score = getScore(record);
                      const scenario = getScenario(record) || "General practice";

                      return (
                        <tr key={record.cloudSessionId}>
                          <td>{dateStr}</td>
                          <td>{scenario}</td>
                          <td>
                            <strong>{score !== null ? formatNumber(score, 0) : "—"}</strong>
                          </td>
                          <td>
                            {durationSec !== null ? formatDuration(durationSec * 1000) : "—"}
                          </td>
                          <td>
                            {compressions !== null ? formatNumber(compressions, 0) : "—"}
                          </td>
                          <td>
                            <a
                              className="detail-link"
                              href="/reports"
                              onClick={(e) => {
                                e.preventDefault();
                                navigate("/reports");
                              }}
                            >
                              View report
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </section>
    );
  }

  // Admin and Instructor Layout
  return (
    <section className="page-section">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Account</p>
          <h2>{user.displayName}</h2>
          <p>{user.email || "No email recorded"}</p>
        </div>
        <span className="role-badge large-badge">{user.role}</span>
      </div>
      
      <div className="state-panel">
        <div>
          <p className="eyebrow">Control Panel</p>
          <h2>Cloud account active</h2>
          <p>Use the navigation shortcuts below or in the menu above to review training stats.</p>
        </div>
      </div>

      <h3 style={{ margin: "24px 0 12px", fontSize: "1.25rem", color: "var(--brand-dark)" }}>
        Quick Navigation
      </h3>

      <div
        className="analytics-grid"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "16px",
        }}
      >
        <div className="metric-card" style={{ cursor: "pointer" }} onClick={() => navigate("/reports")}>
          <p>Reports</p>
          <strong style={{ fontSize: "1.75rem", marginTop: "24px" }}>View Reports</strong>
          <span>Analyze session summaries</span>
        </div>
        <div className="metric-card" style={{ cursor: "pointer" }} onClick={() => navigate("/analytics")}>
          <p>Analytics</p>
          <strong style={{ fontSize: "1.75rem", marginTop: "24px" }}>View Dashboard</strong>
          <span>Examine aggregate stats</span>
        </div>
        {user.role === "ADMIN" && (
          <div className="metric-card" style={{ cursor: "pointer" }} onClick={() => navigate("/management/users")}>
            <p>Users</p>
            <strong style={{ fontSize: "1.75rem", marginTop: "24px" }}>Manage Users</strong>
            <span>Configure access accounts</span>
          </div>
        )}
        <div className="metric-card" style={{ cursor: "pointer" }} onClick={() => navigate("/management/courses")}>
          <p>Courses</p>
          <strong style={{ fontSize: "1.75rem", marginTop: "24px" }}>Manage Courses</strong>
          <span>Enroll trainees & assign instructors</span>
        </div>
      </div>
    </section>
  );
}
