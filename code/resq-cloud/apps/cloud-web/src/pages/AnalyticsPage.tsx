import { useEffect, useState } from "react";
import {
  fetchCloudSessions,
  fetchCloudCourses,
  fetchCloudUsers,
  type CloudSessionRecord,
  type CloudCourse,
  type CloudUser,
} from "../api/cloudApi";
import { EmptyState, ErrorState, LoadingState } from "../components/AsyncState";
import { formatDate, formatNumber, formatDuration } from "../lib/format";
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

function getScore(record: any): number | null {
  return getField<number>(
    record,
    ["payload.score", "score", "payload.summary.score", "summary.score", "metrics.score"],
    "number"
  );
}

function getDurationSeconds(record: any): number | null {
  const val = getField<number>(
    record,
    ["payload.durationMs", "durationMs", "payload.summary.durationMs", "summary.durationMs"],
    "number"
  );
  if (val === null) {
    return getField<number>(
      record,
      ["payload.durationSeconds", "durationSeconds", "payload.summary.durationSeconds", "summary.durationSeconds"],
      "number"
    );
  }
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

function getCourseLabel(record: any, courses: CloudCourse[]): string {
  const paths = ["payload.courseId", "courseId", "cloudCourseId", "course.id", "sourcePayload.courseId", "payload.localCourseId"];
  let courseIdVal = "";
  for (const path of paths) {
    const val = getField<string>(record, [path], "string");
    if (val) {
      courseIdVal = val;
      break;
    }
  }

  const courseObj = courses.find((c) => c.courseId === courseIdVal || c.courseCode === courseIdVal);
  if (courseObj) {
    return `${courseObj.courseCode || ""} - ${courseObj.title}`.trim();
  }

  const fallbackCode = getField<string>(record, ["payload.courseCode", "courseCode", "course.courseCode", "course.code"], "string");
  const fallbackTitle = getField<string>(record, ["payload.courseTitle", "courseTitle", "course.title", "courseName"], "string");
  if (fallbackCode || fallbackTitle) {
    return `${fallbackCode || ""} ${fallbackTitle || ""}`.trim();
  }
  return courseIdVal || "Unknown Course";
}

function getTraineeLabel(record: any, users: CloudUser[]): string {
  const paths = ["payload.traineeId", "traineeId", "cloudTraineeId", "trainee.id", "sourcePayload.traineeId"];
  let traineeIdVal = "";
  for (const path of paths) {
    const val = getField<string>(record, [path], "string");
    if (val) {
      traineeIdVal = val;
      break;
    }
  }

  const traineeObj = users.find((u) => u.userId === traineeIdVal);
  if (traineeObj) {
    return `${traineeObj.displayName} (${traineeObj.email || "no email"})`;
  }

  const fallbackName = getField<string>(record, ["payload.traineeName", "traineeName", "trainee.displayName"], "string");
  const fallbackEmail = getField<string>(record, ["payload.traineeEmail", "traineeEmail", "trainee.email"], "string");
  if (fallbackName || fallbackEmail) {
    return `${fallbackName || "Unknown Trainee"} (${fallbackEmail || "no email"})`;
  }
  return traineeIdVal || "Unknown Trainee";
}

function matchCourse(record: any, courseFilter: string): boolean {
  if (!courseFilter || courseFilter === "all") return true;
  const paths = [
    "payload.courseId",
    "courseId",
    "cloudCourseId",
    "course.id",
    "courseCode",
    "course.courseCode",
    "course.code",
    "localCourseId",
    "sourcePayload.courseId",
    "sourcePayload.localCourseId",
    "payload.localCourseId",
  ];
  for (const path of paths) {
    const val = getField<string>(record, [path], "string");
    if (val === courseFilter) return true;
  }
  return false;
}

function matchTrainee(record: any, traineeFilter: string): boolean {
  if (!traineeFilter || traineeFilter === "all") return true;
  const paths = [
    "payload.traineeId",
    "traineeId",
    "cloudTraineeId",
    "trainee.id",
    "traineeEmail",
    "trainee.email",
    "localTraineeId",
    "sourcePayload.traineeId",
    "sourcePayload.localTraineeId",
    "payload.localTraineeId",
  ];
  for (const path of paths) {
    const val = getField<string>(record, [path], "string");
    if (val === traineeFilter) return true;
  }
  return false;
}

export function AnalyticsPage() {
  const [sessions, setSessions] = useState<CloudSessionRecord[]>([]);
  const [courses, setCourses] = useState<CloudCourse[]>([]);
  const [users, setUsers] = useState<CloudUser[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [metadataWarning, setMetadataWarning] = useState(false);

  // Filter states
  const [courseFilter, setCourseFilter] = useState("all");
  const [traineeFilter, setTraineeFilter] = useState("all");
  const [dateFromFilter, setDateFromFilter] = useState("");
  const [dateToFilter, setDateToFilter] = useState("");

  async function loadData() {
    setIsLoading(true);
    setSessionsError(null);
    setMetadataWarning(false);
    try {
      const sessionRecords = await fetchCloudSessions();
      setSessions(sessionRecords);

      try {
        const [courseRecords, userRecords] = await Promise.all([
          fetchCloudCourses(),
          fetchCloudUsers(),
        ]);
        setCourses(courseRecords);
        setUsers(userRecords);
      } catch (metaErr) {
        console.warn("Metadata load failed, using session payload fallbacks.", metaErr);
        setMetadataWarning(true);
      }
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : "Could not load session reports.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  if (isLoading) return <LoadingState message="Calculating cloud session analytics…" />;
  if (sessionsError) return <ErrorState message={sessionsError} onRetry={() => void loadData()} />;
  if (sessions.length === 0) return <EmptyState />;

  // Filter application
  const filteredSessions = sessions.filter((record) => {
    // Course filter
    if (!matchCourse(record, courseFilter)) return false;

    // Trainee filter
    if (!matchTrainee(record, traineeFilter)) return false;

    // Date filters (inclusive of local day boundaries)
    const dateObj = getBestDate(record);
    if (dateObj) {
      if (dateFromFilter) {
        const [y, m, d] = dateFromFilter.split("-").map(Number);
        const fromDateObj = new Date(y, m - 1, d, 0, 0, 0, 0);
        if (dateObj < fromDateObj) return false;
      }
      if (dateToFilter) {
        const [y, m, d] = dateToFilter.split("-").map(Number);
        const toDateObj = new Date(y, m - 1, d, 23, 59, 59, 999);
        if (dateObj > toDateObj) return false;
      }
    } else {
      if (dateFromFilter || dateToFilter) return false;
    }

    return true;
  });

  // Unique filter option derivations
  const courseOptions = Array.from(
    new Set(
      sessions
        .map((s) => {
          const id = getField<string>(s, ["payload.courseId", "courseId", "cloudCourseId"], "string");
          const code = getField<string>(s, ["payload.courseCode", "courseCode", "course.courseCode"], "string");
          return id || code || "";
        })
        .filter((val): val is string => !!val)
    )
  ).map((courseId) => {
    const courseObj = courses.find((c) => c.courseId === courseId || c.courseCode === courseId);
    return {
      value: courseId,
      label: courseObj ? `${courseObj.courseCode || ""} - ${courseObj.title}` : courseId,
    };
  });

  const traineeOptions = Array.from(
    new Set(
      sessions
        .map((s) => getField<string>(s, ["payload.traineeId", "traineeId", "cloudTraineeId"], "string"))
        .filter((id): id is string => !!id)
    )
  ).map((traineeId) => {
    const userObj = users.find((u) => u.userId === traineeId);
    const matchedSess = sessions.find((s) => getField(s, ["payload.traineeId", "traineeId"], "string") === traineeId);
    const fallbackName = getField<string>(matchedSess, ["payload.traineeName", "traineeName", "trainee.displayName"], "string");
    const fallbackEmail = getField<string>(matchedSess, ["payload.traineeEmail", "traineeEmail", "trainee.email"], "string");
    const label = userObj
      ? `${userObj.displayName} (${userObj.email || "no email"})`
      : fallbackName
      ? `${fallbackName} (${fallbackEmail || "no email"})`
      : traineeId;
    return {
      value: traineeId,
      label,
    };
  });

  // Reset helper
  const handleReset = () => {
    setCourseFilter("all");
    setTraineeFilter("all");
    setDateFromFilter("");
    setDateToFilter("");
  };

  // KPI calculations
  const totalCount = filteredSessions.length;
  const scores = filteredSessions.map(getScore).filter((s): s is number => s !== null);
  const bestScore = scores.length > 0 ? Math.max(...scores) : null;
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  const rates = filteredSessions.map(getAvgRateCpm).filter((r): r is number => r !== null);
  const avgRate = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : null;

  const depths = filteredSessions.map(getAvgDepthMm).filter((d): d is number => d !== null);
  const avgDepth = depths.length > 0 ? depths.reduce((a, b) => a + b, 0) / depths.length : null;

  const compressionsList = filteredSessions.map(getTotalCompressions).filter((c): c is number => c !== null);
  const totalCompressions = compressionsList.reduce((a, b) => a + b, 0);

  // Sorting for date computations
  const sortedSessions = [...filteredSessions].sort((a, b) => {
    const dateA = getBestDate(a)?.getTime() || 0;
    const dateB = getBestDate(b)?.getTime() || 0;
    return dateB - dateA;
  });

  const latestDate = sortedSessions.length > 0 ? getBestDate(sortedSessions[0]) : null;
  const latestDateStr = latestDate ? formatDate(latestDate.toISOString()) : "Unknown date";

  // Trend sessions (sorted chronologically)
  const trendSessions = [...filteredSessions]
    .sort((a, b) => {
      const dateA = getBestDate(a)?.getTime() || 0;
      const dateB = getBestDate(b)?.getTime() || 0;
      return dateA - dateB;
    })
    .slice(-10);

  // Course Comparison or Trainee Breakdown Groupings
  interface GroupedMetric {
    key: string;
    label: string;
    sessions: number;
    avgScore: number | null;
    bestScore: number | null;
    avgRate: number | null;
    avgDepth: number | null;
    latestDate: Date | null;
  }

  const groupedData: GroupedMetric[] = [];
  if (courseFilter === "all") {
    // Group by courseId
    const groups: Record<string, CloudSessionRecord[]> = {};
    for (const s of filteredSessions) {
      const courseId = getField<string>(s, ["payload.courseId", "courseId", "cloudCourseId"], "string") || "unassigned";
      if (!groups[courseId]) groups[courseId] = [];
      groups[courseId].push(s);
    }
    for (const [key, records] of Object.entries(groups)) {
      const groupScores = records.map(getScore).filter((s): s is number => s !== null);
      const groupRates = records.map(getAvgRateCpm).filter((r): r is number => r !== null);
      const groupDepths = records.map(getAvgDepthMm).filter((d): d is number => d !== null);
      const groupDates = records.map(getBestDate).filter((d): d is Date => d !== null);

      groupedData.push({
        key,
        label: key === "unassigned" ? "Unassigned Course" : getCourseLabel(records[0], courses),
        sessions: records.length,
        avgScore: groupScores.length > 0 ? groupScores.reduce((a, b) => a + b, 0) / groupScores.length : null,
        bestScore: groupScores.length > 0 ? Math.max(...groupScores) : null,
        avgRate: groupRates.length > 0 ? groupRates.reduce((a, b) => a + b, 0) / groupRates.length : null,
        avgDepth: groupDepths.length > 0 ? groupDepths.reduce((a, b) => a + b, 0) / groupDepths.length : null,
        latestDate: groupDates.length > 0 ? new Date(Math.max(...groupDates.map((d) => d.getTime()))) : null,
      });
    }
  } else {
    // Group by traineeId
    const groups: Record<string, CloudSessionRecord[]> = {};
    for (const s of filteredSessions) {
      const traineeId = getField<string>(s, ["payload.traineeId", "traineeId", "cloudTraineeId"], "string") || "unknown";
      if (!groups[traineeId]) groups[traineeId] = [];
      groups[traineeId].push(s);
    }
    for (const [key, records] of Object.entries(groups)) {
      const groupScores = records.map(getScore).filter((s): s is number => s !== null);
      const groupRates = records.map(getAvgRateCpm).filter((r): r is number => r !== null);
      const groupDepths = records.map(getAvgDepthMm).filter((d): d is number => d !== null);
      const groupDates = records.map(getBestDate).filter((d): d is Date => d !== null);

      groupedData.push({
        key,
        label: key === "unknown" ? "Unknown Trainee" : getTraineeLabel(records[0], users),
        sessions: records.length,
        avgScore: groupScores.length > 0 ? groupScores.reduce((a, b) => a + b, 0) / groupScores.length : null,
        bestScore: groupScores.length > 0 ? Math.max(...groupScores) : null,
        avgRate: groupRates.length > 0 ? groupRates.reduce((a, b) => a + b, 0) / groupRates.length : null,
        avgDepth: groupDepths.length > 0 ? groupDepths.reduce((a, b) => a + b, 0) / groupDepths.length : null,
        latestDate: groupDates.length > 0 ? new Date(Math.max(...groupDates.map((d) => d.getTime()))) : null,
      });
    }
  }

  return (
    <section className="page-section">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Aggregate Review</p>
          <h2>Analytics</h2>
          <p>Examine performance summaries and trainee improvement trends.</p>
        </div>
      </div>

      {metadataWarning && (
        <div className="notification-banner notification-banner--error" style={{ marginBottom: "16px" }}>
          <span>Warning: Course/Trainee metadata unavailable. Falling back to session records.</span>
          <button onClick={() => setMetadataWarning(false)}>&times;</button>
        </div>
      )}

      {/* Filters Form */}
      <div className="form-card" style={{ padding: "20px" }}>
        <div>
          <p className="eyebrow">Filters</p>
          <h3 style={{ margin: "0 0 16px" }}>Refine Analytics Scope</h3>
        </div>
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ display: "grid", gap: "6px", flex: "1 1 200px" }}>
            Course
            <select value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)}>
              <option value="all">All courses</option>
              {courseOptions.map((opt) => (
                <option value={opt.value} key={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: "6px", flex: "1 1 200px" }}>
            Trainee
            <select value={traineeFilter} onChange={(e) => setTraineeFilter(e.target.value)}>
              <option value="all">All trainees</option>
              {traineeOptions.map((opt) => (
                <option value={opt.value} key={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: "6px", flex: "1 1 150px" }}>
            Date From
            <input type="date" value={dateFromFilter} onChange={(e) => setDateFromFilter(e.target.value)} />
          </label>
          <label style={{ display: "grid", gap: "6px", flex: "1 1 150px" }}>
            Date To
            <input type="date" value={dateToFilter} onChange={(e) => setDateToFilter(e.target.value)} />
          </label>
          <button
            type="button"
            className="button button--secondary"
            onClick={handleReset}
            style={{ height: "42px", margin: 0 }}
          >
            Reset Filters
          </button>
        </div>
      </div>

      {totalCount === 0 ? (
        <div className="state-panel">
          <div>
            <h2>No records match filters</h2>
            <p>No sessions match the selected filters.</p>
          </div>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div
            className="analytics-grid"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "16px",
            }}
          >
            <div className="metric-card">
              <p>Total Sessions</p>
              <strong>{totalCount}</strong>
              <span>Filtered session runs</span>
            </div>
            <div className="metric-card">
              <p>Average Score</p>
              <strong>{avgScore !== null ? formatNumber(avgScore, 1) : "—"}</strong>
              <span>CPR accuracy score</span>
            </div>
            <div className="metric-card">
              <p>Best Score</p>
              <strong>{bestScore !== null ? formatNumber(bestScore, 0) : "—"}</strong>
              <span>Highest accuracy score</span>
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
              <p>Total Compressions</p>
              <strong>{formatNumber(totalCompressions, 0)}</strong>
              <span>Across all runs</span>
            </div>
            <div className="metric-card">
              <p>Latest Session</p>
              <strong style={{ fontSize: "1.45rem", marginTop: "24px" }}>{latestDateStr}</strong>
              <span>Most recent date</span>
            </div>
          </div>

          {/* Trend Section */}
          <div>
            <h3 style={{ margin: "24px 0 12px", fontSize: "1.25rem", color: "var(--brand-dark)" }}>
              Training Improvement Trend (Last 10 Runs)
            </h3>
            <div className="table-card">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Course</th>
                      <th>Trainee</th>
                      <th>Score</th>
                      <th>Avg Depth</th>
                      <th>Avg Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trendSessions.map((record) => {
                      const dObj = getBestDate(record);
                      const dStr = dObj ? formatDate(dObj.toISOString()) : "Unknown date";
                      return (
                        <tr key={record.cloudSessionId}>
                          <td>{dStr}</td>
                          <td>{getCourseLabel(record, courses)}</td>
                          <td>{getTraineeLabel(record, users)}</td>
                          <td>
                            <strong>{getScore(record) ?? "—"}</strong>
                          </td>
                          <td>{formatNumber(getAvgDepthMm(record), 1)} mm</td>
                          <td>{formatNumber(getAvgRateCpm(record), 1)} cpm</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Conditional Comparison Section */}
          <div>
            <h3 style={{ margin: "24px 0 12px", fontSize: "1.25rem", color: "var(--brand-dark)" }}>
              {courseFilter === "all" ? "Course Comparison Breakdown" : "Trainee Performance Breakdown"}
            </h3>
            <div className="table-card">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{courseFilter === "all" ? "Course" : "Trainee"}</th>
                      <th>Sessions</th>
                      <th>Average Score</th>
                      <th>Best Score</th>
                      <th>Average Rate</th>
                      <th>Average Depth</th>
                      <th>Latest Session</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedData.map((group) => (
                      <tr key={group.key}>
                        <td>{group.label}</td>
                        <td>{group.sessions}</td>
                        <td>
                          <strong>{group.avgScore !== null ? formatNumber(group.avgScore, 1) : "—"}</strong>
                        </td>
                        <td>{group.bestScore !== null ? formatNumber(group.bestScore, 0) : "—"}</td>
                        <td>{group.avgRate !== null ? `${formatNumber(group.avgRate, 1)} cpm` : "—"}</td>
                        <td>{group.avgDepth !== null ? `${formatNumber(group.avgDepth, 1)} mm` : "—"}</td>
                        <td>{group.latestDate ? formatDate(group.latestDate.toISOString()) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Recent Sessions List */}
          <div>
            <h3 style={{ margin: "24px 0 12px", fontSize: "1.25rem", color: "var(--brand-dark)" }}>
              Recent Filtered Sessions
            </h3>
            <div className="table-card">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Course</th>
                      <th>Trainee</th>
                      <th>Scenario</th>
                      <th>Score</th>
                      <th>Duration</th>
                      <th>Avg Rate</th>
                      <th>Avg Depth</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSessions.slice(0, 5).map((record) => {
                      const dObj = getBestDate(record);
                      const dStr = dObj ? formatDate(dObj.toISOString()) : "Unknown date";
                      const durationSec = getDurationSeconds(record);

                      return (
                        <tr key={record.cloudSessionId}>
                          <td>{dStr}</td>
                          <td>{getCourseLabel(record, courses)}</td>
                          <td>{getTraineeLabel(record, users)}</td>
                          <td>{getScenario(record) || "General practice"}</td>
                          <td>
                            <strong>{getScore(record) ?? "—"}</strong>
                          </td>
                          <td>{durationSec !== null ? formatDuration(durationSec * 1000) : "—"}</td>
                          <td>{formatNumber(getAvgRateCpm(record), 1)} cpm</td>
                          <td>{formatNumber(getAvgDepthMm(record), 1)} mm</td>
                          <td>
                            <a
                              className="detail-link"
                              href="/reports"
                              onClick={(e) => {
                                e.preventDefault();
                                navigate("/reports");
                              }}
                            >
                              View reports
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
