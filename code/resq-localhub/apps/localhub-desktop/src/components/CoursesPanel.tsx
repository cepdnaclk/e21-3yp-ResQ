/**
 * CoursesPanel.tsx
 *
 * Role-scoped course directory with session initiation controls.
 *
 * Role visibility rules (strictly enforced at the call-site guard level):
 *  - ADMIN     : All courses, all instructors, all enrolled students, session controls visible
 *  - INSTRUCTOR: Only assigned courses (backend-filtered), instructors, students, session controls visible
 *  - TRAINEE   : Only enrolled courses + instructors; NO student calls; NO session controls
 */
import { useCallback, useEffect, useState } from "react";
import type { ManikinLiveSummary } from "../lib/browserManikinsApi";
import type { FirmwareReadinessResponse } from "../lib/browserFirmwareApi";
import {
  listCourses,
  listCourseInstructors,
  listCourseStudents,
  type CourseView,
  type CourseInstructorView,
  type CourseStudentView,
} from "../lib/browserRosterSyncApi";
import { startSession } from "../lib/browserSessionsApi";

// ─── Internal types ────────────────────────────────────────────────────────────

type UserRole = "ADMIN" | "INSTRUCTOR" | "TRAINEE";

type SessionDraft = {
  courseId: string;
  traineeId: string;
  deviceId: string;
};

type CourseDetailCache = {
  instructors: CourseInstructorView[];
  students: CourseStudentView[];
  loading: boolean;
  error: string | null;
};

export type CoursesPanelProps = {
  /** Current user's role — used to gate student calls and session controls */
  role: UserRole;
  /** Live manikins used to populate deviceId selector */
  manikins: ManikinLiveSummary[];
  /** Firmware readiness keyed by deviceId */
  readinessByDevice: Record<string, FirmwareReadinessResponse | null | undefined>;
  /** Optional callback when a session is successfully started */
  onSessionStarted?: (sessionId: string, deviceId: string) => void;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function EmptyState({ icon, title, body }: { icon: string; title: string; body?: string }) {
  return (
    <div
      style={{
        padding: "40px 24px",
        textAlign: "center",
        background: "#f8fafc",
        borderRadius: "12px",
        border: "1px dashed #cbd5e1",
      }}
    >
      <div style={{ fontSize: "2.5rem", marginBottom: "12px" }}>{icon}</div>
      <p style={{ margin: 0, fontWeight: 600, color: "#334155" }}>{title}</p>
      {body && (
        <p style={{ margin: "6px 0 0 0", fontSize: "0.85rem", color: "#64748b" }}>
          {body}
        </p>
      )}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: "10px 14px",
        borderRadius: "8px",
        background: "#fee2e2",
        border: "1px solid #fecaca",
        color: "#991b1b",
        fontSize: "0.88rem",
      }}
    >
      {message}
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    ADMIN: { bg: "#eff6ff", text: "#1e40af" },
    INSTRUCTOR: { bg: "#f0fdf4", text: "#166534" },
    TRAINEE: { bg: "#fffbeb", text: "#92400e" },
  };
  const c = colors[role] ?? { bg: "#f1f5f9", text: "#334155" };
  return (
    <span
      style={{
        padding: "2px 8px",
        borderRadius: "999px",
        fontSize: "0.72rem",
        fontWeight: 600,
        background: c.bg,
        color: c.text,
      }}
    >
      {role}
    </span>
  );
}

// ─── Session Controller sub-component ─────────────────────────────────────────

function SessionController({
  courseId,
  students,
  studentsLoading,
  manikins,
  readinessByDevice,
  onSessionStarted,
}: {
  courseId: string;
  students: CourseStudentView[];
  studentsLoading: boolean;
  manikins: ManikinLiveSummary[];
  readinessByDevice: Record<string, FirmwareReadinessResponse | null | undefined>;
  onSessionStarted?: (sessionId: string, deviceId: string) => void;
}) {
  const [draft, setDraft] = useState<SessionDraft>({
    courseId,
    traineeId: "",
    deviceId: manikins[0]?.deviceId ?? "",
  });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [startMessage, setStartMessage] = useState<string | null>(null);

  // Keep courseId in sync
  useEffect(() => {
    setDraft((d) => ({ ...d, courseId }));
  }, [courseId]);

  const noManikins = manikins.length === 0;
  const selectedReadiness = readinessByDevice[draft.deviceId];
  const deviceReady =
    !draft.deviceId ||
    !selectedReadiness ||
    selectedReadiness.firmwareState === "READY_FOR_SESSION" ||
    selectedReadiness.readyForSession === true;

  const startDisabled =
    !draft.courseId ||
    !draft.traineeId ||
    !draft.deviceId ||
    !deviceReady ||
    starting ||
    noManikins;

  function getDisabledReason(): string | null {
    if (noManikins) return "No live manikin detected. Connect a device to start a session.";
    if (!draft.deviceId) return "Select a manikin device.";
    if (!draft.traineeId) return "Select a trainee.";
    if (!deviceReady) return `Device is not ready for a session (${selectedReadiness?.firmwareState ?? "unknown state"}).`;
    if (starting) return "Starting session…";
    return null;
  }

  async function handleStart() {
    if (startDisabled) return;
    setStarting(true);
    setStartError(null);
    setStartMessage(null);

    try {
      const response = await startSession({
        deviceId: draft.deviceId,
        traineeId: draft.traineeId,
      });
      setStartMessage(`Session started — ID: ${response.sessionId}`);
      onSessionStarted?.(response.sessionId, draft.deviceId);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Failed to start session.");
    } finally {
      setStarting(false);
    }
  }

  const disabledReason = getDisabledReason();

  return (
    <div
      style={{
        background: "linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)",
        border: "1px solid #bae6fd",
        borderRadius: "12px",
        padding: "16px",
        marginTop: "16px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginBottom: "12px",
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#0369a1"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "#0c4a6e" }}>
          Start Training Session
        </span>
      </div>

      {noManikins && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: "8px",
            background: "#fef3c7",
            border: "1px solid #fcd34d",
            color: "#92400e",
            fontSize: "0.82rem",
            marginBottom: "12px",
          }}
        >
          No manikin detected. Course and student data are still available — connect a
          manikin to enable session start.
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "10px",
          marginBottom: "12px",
        }}
      >
        {/* Device selector */}
        <label style={{ display: "grid", gap: "4px" }}>
          <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#0c4a6e" }}>
            Manikin Device
          </span>
          <select
            id={`session-device-${courseId}`}
            value={draft.deviceId}
            onChange={(e) =>
              setDraft((d) => ({ ...d, deviceId: e.target.value }))
            }
            disabled={noManikins}
            style={{
              padding: "7px 10px",
              borderRadius: "7px",
              border: "1px solid #bae6fd",
              fontFamily: "inherit",
              fontSize: "0.88rem",
              background: noManikins ? "#f1f5f9" : "#ffffff",
              color: noManikins ? "#94a3b8" : "#0f172a",
            }}
          >
            {noManikins ? (
              <option value="">— No devices —</option>
            ) : (
              manikins.map((m) => (
                <option key={m.deviceId} value={m.deviceId}>
                  {m.deviceId}
                  {m.online ? " ✓" : " (offline)"}
                </option>
              ))
            )}
          </select>
        </label>

        {/* Trainee selector */}
        <label style={{ display: "grid", gap: "4px" }}>
          <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#0c4a6e" }}>
            Trainee
          </span>
          <select
            id={`session-trainee-${courseId}`}
            value={draft.traineeId}
            onChange={(e) =>
              setDraft((d) => ({ ...d, traineeId: e.target.value }))
            }
            disabled={studentsLoading}
            style={{
              padding: "7px 10px",
              borderRadius: "7px",
              border: "1px solid #bae6fd",
              fontFamily: "inherit",
              fontSize: "0.88rem",
              background: "#ffffff",
              color: "#0f172a",
            }}
          >
            <option value="">
              {studentsLoading ? "Loading…" : "— Select trainee —"}
            </option>
            {students.map((s) => (
              <option key={s.cloudUserId} value={s.cloudUserId}>
                {s.displayName}
                {s.email ? ` (${s.email})` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Disabled reason hint */}
      {disabledReason && (
        <p
          style={{
            margin: "0 0 10px 0",
            fontSize: "0.8rem",
            color: "#64748b",
            fontStyle: "italic",
          }}
        >
          {disabledReason}
        </p>
      )}

      {/* Feedback */}
      {startError && <ErrorBanner message={startError} />}
      {startMessage && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: "8px",
            background: "#dcfce7",
            color: "#166534",
            fontSize: "0.88rem",
            marginBottom: "10px",
          }}
        >
          {startMessage}
        </div>
      )}

      <button
        type="button"
        id={`start-session-btn-${courseId}`}
        onClick={handleStart}
        disabled={startDisabled}
        title={disabledReason ?? undefined}
        style={{
          padding: "9px 18px",
          borderRadius: "8px",
          border: "none",
          background: startDisabled
            ? "#e2e8f0"
            : "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
          color: startDisabled ? "#94a3b8" : "#ffffff",
          fontWeight: 700,
          fontSize: "0.88rem",
          cursor: startDisabled ? "not-allowed" : "pointer",
          boxShadow: startDisabled ? "none" : "0 4px 12px rgba(3, 105, 161, 0.25)",
          transition: "all 0.2s ease",
        }}
      >
        {starting ? "Starting…" : "Start Session"}
      </button>
    </div>
  );
}

// ─── Course Detail panel ───────────────────────────────────────────────────────

function CourseDetail({
  course,
  role,
  manikins,
  readinessByDevice,
  onSessionStarted,
}: {
  course: CourseView;
  role: UserRole;
  manikins: ManikinLiveSummary[];
  readinessByDevice: Record<string, FirmwareReadinessResponse | null | undefined>;
  onSessionStarted?: (sessionId: string, deviceId: string) => void;
}) {
  const canStartSession = role === "ADMIN" || role === "INSTRUCTOR";
  const canSeeStudents = role === "ADMIN" || role === "INSTRUCTOR";

  const [detail, setDetail] = useState<CourseDetailCache>({
    instructors: [],
    students: [],
    loading: true,
    error: null,
  });

  const loadDetail = useCallback(async () => {
    setDetail((d) => ({ ...d, loading: true, error: null }));
    try {
      const instructors = await listCourseInstructors(course.cloudCourseId);
      // Only fetch students for ADMIN/INSTRUCTOR — never for TRAINEE
      const students = canSeeStudents
        ? await listCourseStudents(course.cloudCourseId)
        : [];
      setDetail({ instructors, students, loading: false, error: null });
    } catch (err) {
      setDetail((d) => ({
        ...d,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to load course details.",
      }));
    }
  }, [course.cloudCourseId, canSeeStudents]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  return (
    <div
      style={{
        padding: "16px",
        background: "#f8fafc",
        borderRadius: "0 0 12px 12px",
        borderTop: "1px solid #e2e8f0",
      }}
    >
      {detail.loading && (
        <p style={{ margin: 0, color: "#64748b", fontSize: "0.85rem" }}>
          Loading course details…
        </p>
      )}

      {detail.error && <ErrorBanner message={detail.error} />}

      {!detail.loading && !detail.error && (
        <div style={{ display: "grid", gap: "16px" }}>
          {/* Description */}
          {course.description && (
            <p
              style={{
                margin: 0,
                fontSize: "0.88rem",
                color: "#475569",
                lineHeight: 1.55,
              }}
            >
              {course.description}
            </p>
          )}

          {/* Instructors */}
          <div>
            <p
              style={{
                margin: "0 0 8px 0",
                fontSize: "0.8rem",
                fontWeight: 700,
                color: "#64748b",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Instructors ({detail.instructors.length})
            </p>
            {detail.instructors.length === 0 ? (
              <p style={{ margin: 0, fontSize: "0.85rem", color: "#94a3b8" }}>
                No instructors assigned.
              </p>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {detail.instructors.map((inst) => (
                  <div
                    key={inst.cloudUserId}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "6px 12px",
                      background: "#ffffff",
                      border: "1px solid #e2e8f0",
                      borderRadius: "8px",
                      fontSize: "0.85rem",
                    }}
                  >
                    <div
                      style={{
                        width: "28px",
                        height: "28px",
                        borderRadius: "50%",
                        background: "#e0f2fe",
                        color: "#0369a1",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 700,
                        fontSize: "0.75rem",
                        flexShrink: 0,
                      }}
                    >
                      {inst.displayName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, color: "#0f172a" }}>
                        {inst.displayName}
                      </div>
                      {inst.email && (
                        <div style={{ fontSize: "0.78rem", color: "#64748b" }}>
                          {inst.email}
                        </div>
                      )}
                    </div>
                    <RoleBadge role="INSTRUCTOR" />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Students — only for ADMIN / INSTRUCTOR */}
          {canSeeStudents && (
            <div>
              <p
                style={{
                  margin: "0 0 8px 0",
                  fontSize: "0.8rem",
                  fontWeight: 700,
                  color: "#64748b",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Enrolled Students ({detail.students.length})
              </p>
              {detail.students.length === 0 ? (
                <EmptyState
                  icon="🎓"
                  title="No students enrolled"
                  body="Students will appear here once enrolled through the cloud platform."
                />
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                    gap: "8px",
                  }}
                >
                  {detail.students.map((student) => (
                    <div
                      key={student.cloudUserId}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "8px 12px",
                        background: "#ffffff",
                        border: "1px solid #e2e8f0",
                        borderRadius: "8px",
                      }}
                    >
                      <div
                        style={{
                          width: "30px",
                          height: "30px",
                          borderRadius: "50%",
                          background: "#fef3c7",
                          color: "#92400e",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 700,
                          fontSize: "0.78rem",
                          flexShrink: 0,
                        }}
                      >
                        {student.displayName.charAt(0).toUpperCase()}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            color: "#0f172a",
                            fontSize: "0.85rem",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {student.displayName}
                        </div>
                        {student.email && (
                          <div
                            style={{
                              fontSize: "0.75rem",
                              color: "#64748b",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {student.email}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Session controller */}
              {canStartSession && (
                <SessionController
                  courseId={course.cloudCourseId}
                  students={detail.students}
                  studentsLoading={detail.loading}
                  manikins={manikins}
                  readinessByDevice={readinessByDevice}
                  onSessionStarted={onSessionStarted}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main CoursesPanel ─────────────────────────────────────────────────────────

export function CoursesPanel({
  role,
  manikins,
  readinessByDevice,
  onSessionStarted,
}: CoursesPanelProps) {
  const [courses, setCourses] = useState<CourseView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCourseId, setExpandedCourseId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await listCourses();
        setCourses(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load courses.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  function toggleCourse(courseId: string) {
    setExpandedCourseId((current) => (current === courseId ? null : courseId));
  }

  return (
    <section
      style={{
        background: "#ffffff",
        borderRadius: "16px",
        border: "1px solid #e2e8f0",
        boxShadow:
          "0 1px 3px rgba(15, 23, 42, 0.08), 0 8px 24px rgba(15, 23, 42, 0.04)",
        overflow: "hidden",
      }}
      aria-label="Course Directory"
    >
      {/* Panel header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "18px 20px",
          borderBottom: "1px solid #e2e8f0",
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#60a5fa"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: "1.1rem",
              fontWeight: 700,
              color: "#f8fafc",
            }}
          >
            Course Directory
          </h2>
          <p
            style={{
              margin: "2px 0 0 0",
              fontSize: "0.8rem",
              color: "#94a3b8",
            }}
          >
            {role === "TRAINEE"
              ? "Your enrolled courses"
              : "Manage courses and start training sessions"}
          </p>
        </div>
      </div>

      <div style={{ padding: "20px" }}>
        {/* Loading */}
        {loading && (
          <p style={{ margin: 0, color: "#64748b", fontSize: "0.9rem" }}>
            Loading courses…
          </p>
        )}

        {/* Error */}
        {error && !loading && <ErrorBanner message={error} />}

        {/* Empty state */}
        {!loading && !error && courses.length === 0 && (
          <EmptyState
            icon="📚"
            title="No courses available"
            body={
              role === "TRAINEE"
                ? "You are not enrolled in any courses yet."
                : "No courses have been synced from the cloud yet. Run a roster sync to populate courses."
            }
          />
        )}

        {/* Course list */}
        {!loading && !error && courses.length > 0 && (
          <div style={{ display: "grid", gap: "12px" }}>
            {courses.map((course) => {
              const isExpanded = expandedCourseId === course.cloudCourseId;
              return (
                <div
                  key={course.cloudCourseId}
                  style={{
                    border: "1px solid",
                    borderColor: isExpanded ? "#bae6fd" : "#e2e8f0",
                    borderRadius: "12px",
                    overflow: "hidden",
                    transition: "border-color 0.2s ease",
                    boxShadow: isExpanded
                      ? "0 0 0 3px rgba(186, 230, 253, 0.4)"
                      : "none",
                  }}
                >
                  {/* Course card header — click to expand */}
                  <button
                    type="button"
                    id={`course-card-${course.cloudCourseId}`}
                    onClick={() => toggleCourse(course.cloudCourseId)}
                    aria-expanded={isExpanded}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "12px",
                      padding: "14px 16px",
                      background: isExpanded ? "#f0f9ff" : "#ffffff",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "background 0.2s ease",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
                      <div
                        style={{
                          width: "36px",
                          height: "36px",
                          borderRadius: "8px",
                          background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          color: "#ffffff",
                          fontWeight: 700,
                          fontSize: "0.8rem",
                        }}
                      >
                        {course.courseCode
                          ? course.courseCode.slice(0, 4)
                          : course.title.slice(0, 2).toUpperCase()}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <p
                          style={{
                            margin: 0,
                            fontWeight: 700,
                            fontSize: "0.95rem",
                            color: "#0f172a",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {course.label ?? course.title}
                        </p>
                        {course.description && (
                          <p
                            style={{
                              margin: "2px 0 0 0",
                              fontSize: "0.78rem",
                              color: "#64748b",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {course.description}
                          </p>
                        )}
                      </div>
                    </div>
                    {/* Chevron */}
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#64748b"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{
                        flexShrink: 0,
                        transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                        transition: "transform 0.25s ease",
                      }}
                      aria-hidden="true"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <CourseDetail
                      course={course}
                      role={role}
                      manikins={manikins}
                      readinessByDevice={readinessByDevice}
                      onSessionStarted={onSessionStarted}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
