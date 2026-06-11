import { useEffect, useState, useCallback, type FormEvent } from "react";
import {
  listSessionSummaries,
  fetchCloudCourses,
  fetchCloudUsers,
  type CloudUser,
  type CloudCourse,
  type CloudSessionSummaryRecord,
  type SessionSummaryFilters,
  type CloudSessionPayload,
} from "../api/cloudApi";
import { EmptyState, ErrorState, LoadingState } from "../components/AsyncState";
import { formatDate, formatNumber, shortId } from "../lib/format";
import { navigate } from "../router";

interface SessionReportsPageProps {
  user: CloudUser;
}

export function SessionReportsPage({ user }: SessionReportsPageProps) {
  const [summaries, setSummaries] = useState<CloudSessionSummaryRecord[]>([]);
  const [courses, setCourses] = useState<CloudCourse[]>([]);
  const [users, setUsers] = useState<CloudUser[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metadataFailed, setMetadataFailed] = useState(false);

  // Filter input states
  const [courseFilter, setCourseFilter] = useState("");
  const [traineeFilter, setTraineeFilter] = useState("");
  const [instructorFilter, setInstructorFilter] = useState("");
  const [dateFromFilter, setDateFromFilter] = useState("");
  const [dateToFilter, setDateToFilter] = useState("");

  // Active filters for API queries (includes limit & offset)
  const [activeFilters, setActiveFilters] = useState<SessionSummaryFilters>({
    limit: 50,
    offset: 0,
  });

  // Fetch session summaries based on active filters
  const loadReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listSessionSummaries(activeFilters);
      setSummaries(data);
    } catch (err) {
      setError(getSanitizedErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [activeFilters]);

  // Load metadata (courses & users) based on roles
  useEffect(() => {
    if (user.role === "TRAINEE") {
      // Trainees do not call protected course/user list APIs
      return;
    }

    let active = true;
    async function loadMetadata() {
      try {
        const [courseRecords, userRecords] = await Promise.all([
          fetchCloudCourses(),
          fetchCloudUsers(),
        ]);
        if (active) {
          setCourses(courseRecords);
          setUsers(userRecords);
          setMetadataFailed(false);
        }
      } catch (err) {
        if (active) {
          console.warn("Metadata API fetch failed. Custom dropdown derivations will be used.", err);
          setMetadataFailed(true);
        }
      }
    }
    void loadMetadata();
    return () => {
      active = false;
    };
  }, [user.role]);

  // Trigger loading summaries when active filters change
  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  // Calculate unique IDs from loaded summaries as fallback dropdown options
  const derivedCourseIds = Array.from(
    new Set(
      summaries
        .map((s) => s.payload.courseId)
        .filter((id): id is string => typeof id === "string" && id !== "")
    )
  );

  const derivedTraineeIds = Array.from(
    new Set(
      summaries
        .map((s) => s.payload.traineeId)
        .filter((id): id is string => typeof id === "string" && id !== "")
    )
  );

  // Form handlers
  const handleApply = (e: FormEvent) => {
    e.preventDefault();

    let dateFrom: string | undefined;
    if (dateFromFilter) {
      dateFrom = `${dateFromFilter}T00:00:00Z`;
    }

    let dateTo: string | undefined;
    if (dateToFilter) {
      dateTo = `${dateToFilter}T23:59:59Z`;
    }

    setActiveFilters({
      courseId: courseFilter || undefined,
      traineeId: traineeFilter || undefined,
      instructorId: instructorFilter || undefined,
      dateFrom,
      dateTo,
      limit: 50,
      offset: 0, // reset offset to 0 when applying new filters
    });
  };

  const handleClear = () => {
    setCourseFilter("");
    setTraineeFilter("");
    setInstructorFilter("");
    setDateFromFilter("");
    setDateToFilter("");
    setActiveFilters({
      limit: 50,
      offset: 0,
    });
  };

  const handlePrevPage = () => {
    const nextOffset = Math.max(0, (activeFilters.offset || 0) - 50);
    setActiveFilters({ ...activeFilters, offset: nextOffset });
  };

  const handleNextPage = () => {
    const nextOffset = (activeFilters.offset || 0) + 50;
    setActiveFilters({ ...activeFilters, offset: nextOffset });
  };

  // Safe KPI Metric Averages
  const totalSessions = summaries.length;

  const computeAverage = (key: keyof CloudSessionPayload) => {
    const validValues = summaries
      .map((s) => s.payload[key])
      .filter((v): v is number => typeof v === "number" && !Number.isNaN(v));

    if (validValues.length === 0) return "—";
    const sum = validValues.reduce((acc, val) => acc + val, 0);
    return (sum / validValues.length).toFixed(1);
  };

  const avgScore = computeAverage("score");
  const avgDepth = computeAverage("avgDepthMm");
  const avgRate = computeAverage("avgRateCpm");

  // Loading/Error states
  if (loading && summaries.length === 0) {
    return <LoadingState message="Loading session reports..." />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => void loadReports()} />;
  }

  // Column visibilities
  const showCourseCol = true;
  const showTraineeCol = user.role === "ADMIN" || user.role === "INSTRUCTOR";
  const showInstructorCol = user.role === "ADMIN";

  // Check how to render course selection
  const showCourseSelect = !metadataFailed && courses.length > 0;
  const showCourseDerived = metadataFailed && derivedCourseIds.length > 0;

  // Check how to render trainee selection
  const trainees = users.filter((u) => u.active && u.role === "TRAINEE");
  const showTraineeSelect = !metadataFailed && trainees.length > 0;
  const showTraineeDerived = metadataFailed && derivedTraineeIds.length > 0;

  // Instructors/Admins list
  const instructors = users.filter((u) => u.active && (u.role === "INSTRUCTOR" || u.role === "ADMIN"));

  return (
    <section className="page-section">
      {/* Header */}
      <div className="page-heading">
        <div>
          <p className="eyebrow">Reports</p>
          <h2>Session Reports</h2>
          <p>Analyze performance metrics across CPR training sessions.</p>
        </div>
        <span className="count-badge">
          {totalSessions} session{totalSessions === 1 ? "" : "s"}
        </span>
      </div>

      {/* Metric Cards */}
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
          <strong>{totalSessions}</strong>
          <span>Completed summaries</span>
        </div>
        <div className="metric-card">
          <p>Average Score</p>
          <strong>{avgScore}</strong>
          <span>CPR accuracy score</span>
        </div>
        <div className="metric-card">
          <p>Average Depth</p>
          <strong>{avgScore !== "—" && avgDepth !== "—" ? `${avgDepth} mm` : "—"}</strong>
          <span>Compression depth</span>
        </div>
        <div className="metric-card">
          <p>Average Rate</p>
          <strong>{avgScore !== "—" && avgRate !== "—" ? `${avgRate} cpm` : "—"}</strong>
          <span>Compression rate</span>
        </div>
      </div>

      {/* Filters Form */}
      <form className="form-card" onSubmit={handleApply} style={{ marginBottom: "12px" }}>
        <div>
          <p className="eyebrow">Filters</p>
          <h3>Refine Reports Scope</h3>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "16px",
          }}
        >
          {/* Course filter */}
          {user.role !== "TRAINEE" ? (
            <label>
              Course
              {showCourseSelect ? (
                <select
                  value={courseFilter}
                  onChange={(e) => setCourseFilter(e.target.value)}
                >
                  <option value="">All Courses</option>
                  {courses.map((c) => (
                    <option key={c.courseId} value={c.courseId}>
                      {c.courseCode ? `${c.courseCode} - ${c.title}` : c.title}
                    </option>
                  ))}
                </select>
              ) : showCourseDerived ? (
                <select
                  value={courseFilter}
                  onChange={(e) => setCourseFilter(e.target.value)}
                >
                  <option value="">All Courses</option>
                  {derivedCourseIds.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder="Enter Course ID"
                  value={courseFilter}
                  onChange={(e) => setCourseFilter(e.target.value)}
                />
              )}
            </label>
          ) : (
            <label>
              Course ID
              <input
                type="text"
                placeholder="Filter by Course ID"
                value={courseFilter}
                onChange={(e) => setCourseFilter(e.target.value)}
              />
            </label>
          )}

          {/* Trainee filter (Admin & Instructor only) */}
          {user.role === "ADMIN" || user.role === "INSTRUCTOR" ? (
            <label>
              Trainee
              {showTraineeSelect ? (
                <select
                  value={traineeFilter}
                  onChange={(e) => setTraineeFilter(e.target.value)}
                >
                  <option value="">All Trainees</option>
                  {trainees.map((t) => (
                    <option key={t.userId} value={t.userId}>
                      {t.displayName}
                    </option>
                  ))}
                </select>
              ) : showTraineeDerived ? (
                <select
                  value={traineeFilter}
                  onChange={(e) => setTraineeFilter(e.target.value)}
                >
                  <option value="">All Trainees</option>
                  {derivedTraineeIds.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder="Enter Trainee ID"
                  value={traineeFilter}
                  onChange={(e) => setTraineeFilter(e.target.value)}
                />
              )}
            </label>
          ) : null}

          {/* Instructor filter (Admin only) */}
          {user.role === "ADMIN" ? (
            <label>
              Instructor
              {!metadataFailed && instructors.length > 0 ? (
                <select
                  value={instructorFilter}
                  onChange={(e) => setInstructorFilter(e.target.value)}
                >
                  <option value="">All Instructors</option>
                  {instructors.map((i) => (
                    <option key={i.userId} value={i.userId}>
                      {i.displayName} ({i.role})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder="Enter Instructor ID"
                  value={instructorFilter}
                  onChange={(e) => setInstructorFilter(e.target.value)}
                />
              )}
            </label>
          ) : null}

          {/* Date Range filters */}
          <label>
            Date From
            <input
              type="date"
              value={dateFromFilter}
              onChange={(e) => setDateFromFilter(e.target.value)}
            />
          </label>

          <label>
            Date To
            <input
              type="date"
              value={dateToFilter}
              onChange={(e) => setDateToFilter(e.target.value)}
            />
          </label>
        </div>

        <div className="form-actions" style={{ justifyContent: "flex-end", marginTop: "12px" }}>
          <button
            type="button"
            className="button button--secondary"
            onClick={handleClear}
          >
            Clear
          </button>
          <button type="submit" className="button">
            Apply Filters
          </button>
        </div>
      </form>

      {/* Reports Table/Cards list */}
      {summaries.length === 0 ? (
        <EmptyState
          title="No summaries found"
          message="No session summaries found for the selected filters."
        />
      ) : (
        <div className="table-card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Started At</th>
                  {showCourseCol ? <th>Course ID</th> : null}
                  {showTraineeCol ? <th>Trainee ID</th> : null}
                  {showInstructorCol ? <th>Instructor ID</th> : null}
                  <th>Scenario</th>
                  <th>Compressions (Valid / Total)</th>
                  <th>Avg Depth</th>
                  <th>Avg Rate</th>
                  <th>Recoil OK</th>
                  <th>Pauses</th>
                  <th>Score</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {summaries.map((record) => {
                  const payload = record.payload;
                  const displayDate = formatDate(payload.startedAt || record.createdAt);
                  const courseIdVal = payload.courseId || "—";
                  const traineeIdVal = payload.traineeId || "—";
                  const instructorIdVal = payload.instructorId || "—";
                  const scenarioVal = payload.scenario || "—";
                  const statusVal = payload.status || payload.result || "Unknown";

                  return (
                    <tr key={record.cloudSessionId}>
                      <td>{displayDate}</td>
                      {showCourseCol ? (
                        <td>
                          <code title={courseIdVal}>{shortId(courseIdVal)}</code>
                        </td>
                      ) : null}
                      {showTraineeCol ? (
                        <td>
                          <code title={traineeIdVal}>{shortId(traineeIdVal)}</code>
                        </td>
                      ) : null}
                      {showInstructorCol ? (
                        <td>
                          <code title={instructorIdVal}>{shortId(instructorIdVal)}</code>
                        </td>
                      ) : null}
                      <td>{scenarioVal}</td>
                      <td>
                        {formatNumber(payload.validCompressions, 0)} / {formatNumber(payload.totalCompressions, 0)}
                      </td>
                      <td>{formatNumber(payload.avgDepthMm, 1)} mm</td>
                      <td>{formatNumber(payload.avgRateCpm, 1)} cpm</td>
                      <td>{formatNumber(payload.recoilOkPct, 1)}%</td>
                      <td>{formatNumber(payload.pauseCount, 0)}</td>
                      <td>{formatNumber(payload.score, 0)}</td>
                      <td>
                        <span className="status-badge">{statusVal}</span>
                      </td>
                      <td>
                        <a
                          className="detail-link"
                          href={`/sessions/${record.cloudSessionId}`}
                          onClick={(e) => {
                            e.preventDefault();
                            navigate(`/sessions/${record.cloudSessionId}`);
                          }}
                        >
                          View details
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Simple Pagination Footer */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "15px 20px",
              borderTop: "1px solid var(--line)",
            }}
          >
            <span style={{ fontSize: "0.86rem", color: "var(--muted)" }}>
              Showing page offset {activeFilters.offset || 0}
            </span>
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                type="button"
                className="button button--secondary"
                style={{ margin: 0, padding: "6px 12px", fontSize: "0.8rem" }}
                disabled={activeFilters.offset === 0}
                onClick={handlePrevPage}
              >
                Previous
              </button>
              <button
                type="button"
                className="button button--secondary"
                style={{ margin: 0, padding: "6px 12px", fontSize: "0.8rem" }}
                disabled={summaries.length < 50}
                onClick={handleNextPage}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// Sanitizes error messages to ensure sensitive tokens and hashes are not displayed in the UI
function getSanitizedErrorMessage(err: unknown): string {
  if (err && typeof err === "object") {
    const apiErr = err as { status?: number; message?: string };
    if (apiErr.status === 403) {
      return "You do not have permission to view these reports.";
    }
    if (apiErr.status === 404) {
      return "No accessible reports found for this selection.";
    }

    let msg = apiErr.message || "An error occurred while loading session reports.";
    // Redact credentials, tokens, or hashes
    msg = msg.replace(
      /(bearer\s+|auth=|token=|key=|password_hash=|local_login_hash=)[a-zA-Z0-9_\-\.]+/gi,
      "[REDACTED]"
    );
    return msg;
  }
  return "An error occurred while loading session reports.";
}
