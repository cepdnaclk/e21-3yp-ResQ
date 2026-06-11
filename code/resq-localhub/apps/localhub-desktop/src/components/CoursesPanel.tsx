import React, { useEffect, useState } from "react";
import { Dialog, DialogFooter } from "./ui/dialog";
import {
  getRosterSyncStatus,
  runRosterSync,
  listCourses,
  listCourseStudents,
  listCourseInstructors,
  type CourseView,
  type CourseStudentView,
  type CourseInstructorView,
  type SyncStateRecord,
} from "../lib/browserRosterSyncApi";

type CoursesPanelProps = {
  role: "ADMIN" | "INSTRUCTOR" | "TRAINEE";
};

export function CoursesPanel({ role }: CoursesPanelProps) {
  const [syncStatus, setSyncStatus] = useState<SyncStateRecord | null>(null);
  const [courses, setCourses] = useState<CourseView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const [selectedCourse, setSelectedCourse] = useState<CourseView | null>(null);
  const [students, setStudents] = useState<CourseStudentView[]>([]);
  const [instructors, setInstructors] = useState<CourseInstructorView[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const fetchCoursesAndStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const fetchedCourses = await listCourses();
      setCourses(fetchedCourses);

      if (role === "ADMIN") {
        const fetchedStatus = await getRosterSyncStatus();
        setSyncStatus(fetchedStatus);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load course data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCoursesAndStatus();
  }, [role]);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      await runRosterSync();
      await fetchCoursesAndStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync roster");
    } finally {
      setSyncing(false);
    }
  };

  const handleSelectCourse = async (course: CourseView) => {
    setSelectedCourse(course);
    setDetailLoading(true);
    setDetailError(null);
    setStudents([]);
    setInstructors([]);
    setDialogOpen(true);

    try {
      // Instructors can be viewed by all roles
      const fetchedInstructors = await listCourseInstructors(course.cloudCourseId);
      setInstructors(fetchedInstructors);

      // Enrolled students can only be viewed by ADMIN or INSTRUCTOR (403 for TRAINEE)
      if (role !== "TRAINEE") {
        const fetchedStudents = await listCourseStudents(course.cloudCourseId);
        setStudents(fetchedStudents);
      }
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Failed to load course details");
    } finally {
      setDetailLoading(false);
    }
  };

  const formatDate = (val: string | null) => {
    if (!val) return "Never";
    try {
      return new Date(val).toLocaleString();
    } catch {
      return val;
    }
  };

  return (
    <div style={{ display: "grid", gap: "16px" }}>
      {/* 1. Admin Sync Status Card */}
      {role === "ADMIN" && (
        <section style={styles.card}>
          <div style={styles.headerRow}>
            <div>
              <h2 style={styles.heading}>Cloud Roster Sync</h2>
              <p style={styles.subheading}>Pull classrooms, students, and instructor credentials from the ResQ Cloud service.</p>
            </div>
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing}
              style={{
                ...styles.btn,
                background: syncing ? "#e2e8f0" : "#0f172a",
                color: syncing ? "#94a3b8" : "#ffffff",
                cursor: syncing ? "not-allowed" : "pointer",
              }}
            >
              {syncing ? "Syncing..." : "Sync Now"}
            </button>
          </div>

          {syncStatus ? (
            <div style={styles.syncStatsGrid}>
              <div style={styles.statBox}>
                <div style={styles.statLabel}>Last Attempt</div>
                <div style={styles.statValue}>{formatDate(syncStatus.lastAttemptAt)}</div>
              </div>
              <div style={styles.statBox}>
                <div style={styles.statLabel}>Last Success</div>
                <div style={styles.statValue}>{formatDate(syncStatus.lastSuccessAt)}</div>
              </div>
              <div style={styles.statBox}>
                <div style={styles.statLabel}>Synced Users</div>
                <div style={styles.statValue}>{syncStatus.lastUserCount ?? 0}</div>
              </div>
              <div style={styles.statBox}>
                <div style={styles.statLabel}>Synced Courses</div>
                <div style={styles.statValue}>{syncStatus.lastCourseCount ?? 0}</div>
              </div>
              <div style={styles.statBox}>
                <div style={styles.statLabel}>Enrolled Trainees</div>
                <div style={styles.statValue}>{syncStatus.lastEnrollmentCount ?? 0}</div>
              </div>
              {syncStatus.lastError && (
                <div style={{ ...styles.statBox, gridColumn: "1 / -1", borderLeft: "4px solid #ef4444" }}>
                  <div style={{ ...styles.statLabel, color: "#ef4444" }}>Last Error</div>
                  <div style={{ ...styles.statValue, color: "#b91c1c", fontSize: "0.85rem" }}>{syncStatus.lastError}</div>
                </div>
              )}
            </div>
          ) : (
            <p style={styles.message}>No sync status recorded yet.</p>
          )}
        </section>
      )}

      {/* 2. Courses List section */}
      <section style={styles.card}>
        <div style={styles.headerRow}>
          <div>
            <h2 style={styles.heading}>{role === "TRAINEE" ? "My Enrolled Courses" : "Classroom Courses"}</h2>
            <p style={styles.subheading}>
              {role === "TRAINEE"
                ? "Select a course to view details and assigned instructors."
                : "Select a course to view detail metadata and class list rosters."}
            </p>
          </div>
          <button type="button" onClick={fetchCoursesAndStatus} disabled={loading} style={styles.refreshBtn}>
            Refresh List
          </button>
        </div>

        {loading && <p style={styles.message}>Loading courses...</p>}
        {error && <p style={styles.error}>{error}</p>}

        {!loading && !error && courses.length === 0 ? (
          <div style={styles.emptyContainer}>
            <p style={styles.emptyText}>No courses synced yet. Ask an admin to run roster sync.</p>
          </div>
        ) : (
          <div style={styles.courseGrid}>
            {courses.map((course) => (
              <button
                key={course.cloudCourseId}
                type="button"
                onClick={() => handleSelectCourse(course)}
                style={styles.courseCard}
              >
                <div style={styles.courseHeader}>
                  <span style={styles.courseCode}>{course.courseCode ?? "RSQ-COURSE"}</span>
                  <span style={styles.activeBadge}>{course.active ? "Active" : "Inactive"}</span>
                </div>
                <h3 style={styles.courseTitle}>{course.title}</h3>
                {course.description && (
                  <p style={styles.courseDesc}>{course.description}</p>
                )}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 3. Course Details Dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={selectedCourse ? `${selectedCourse.courseCode ?? ""} - ${selectedCourse.title}` : "Course Details"}
      >
        {detailLoading ? (
          <p style={styles.message}>Loading roster...</p>
        ) : detailError ? (
          <p style={styles.error}>{detailError}</p>
        ) : selectedCourse ? (
          <div style={{ display: "grid", gap: "16px", maxHeight: "60vh", overflowY: "auto", paddingRight: "4px" }}>
            {/* Description */}
            <div>
              <div style={styles.sectionHeading}>Description</div>
              <p style={{ margin: "4px 0 0 0", fontSize: "0.9rem", color: "#475569", lineHeight: 1.4 }}>
                {selectedCourse.description ?? "No description provided."}
              </p>
            </div>

            {/* Instructors list */}
            <div>
              <div style={styles.sectionHeading}>Instructors ({instructors.length})</div>
              {instructors.length === 0 ? (
                <p style={styles.rosterEmptyText}>No instructors assigned.</p>
              ) : (
                <div style={styles.rosterList}>
                  {instructors.map((inst) => (
                    <div key={inst.cloudUserId} style={styles.rosterItem}>
                      <div style={styles.rosterItemMain}>
                        <span style={styles.rosterName}>{inst.displayName}</span>
                        {inst.email && <span style={styles.rosterEmail}>{inst.email}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Students list - Admin/Instructor only */}
            {role !== "TRAINEE" && (
              <div>
                <div style={styles.sectionHeading}>Enrolled Students ({students.length})</div>
                {students.length === 0 ? (
                  <p style={styles.rosterEmptyText}>No students enrolled.</p>
                ) : (
                  <div style={styles.rosterList}>
                    {students.map((student) => (
                      <div key={student.cloudUserId} style={styles.rosterItem}>
                        <div style={styles.rosterItemMain}>
                          <span style={styles.rosterName}>{student.displayName}</span>
                          {student.email && <span style={styles.rosterEmail}>{student.email}</span>}
                        </div>
                        {student.enrolledAt && (
                          <div style={styles.rosterItemSide}>
                            Enrolled: {new Date(student.enrolledAt).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <button
            type="button"
            onClick={() => setDialogOpen(false)}
            style={{
              padding: "8px 16px",
              borderRadius: "6px",
              border: "1px solid #cbd5e1",
              background: "#ffffff",
              color: "#334155",
              fontWeight: 600,
              cursor: "pointer",
              fontSize: "0.9rem",
            }}
          >
            Close
          </button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

const styles = {
  card: {
    background: "#ffffff",
    borderRadius: "12px",
    border: "1px solid #e5e7eb",
    padding: "18px",
    boxShadow: "0 1px 3px rgba(15, 23, 42, 0.08), 0 8px 24px rgba(15, 23, 42, 0.04)",
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "12px",
    marginBottom: "16px",
    flexWrap: "wrap" as const,
  },
  heading: {
    margin: 0,
    fontSize: "1.1rem",
    fontWeight: 600,
    color: "#0f172a",
  },
  subheading: {
    margin: "4px 0 0 0",
    color: "#64748b",
    fontSize: "0.88rem",
    lineHeight: 1.4,
  },
  btn: {
    padding: "8px 14px",
    borderRadius: "6px",
    border: "none",
    fontWeight: 600,
    fontSize: "0.88rem",
    transition: "background 150ms ease",
  },
  refreshBtn: {
    padding: "6px 12px",
    borderRadius: "6px",
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#334155",
    fontWeight: 600,
    fontSize: "0.85rem",
    cursor: "pointer",
  },
  syncStatsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "10px",
    marginTop: "8px",
  },
  statBox: {
    padding: "10px 12px",
    borderRadius: "8px",
    border: "1px solid #f1f5f9",
    background: "#f8fafc",
    display: "grid",
    gap: "4px",
  },
  statLabel: {
    fontSize: "0.7rem",
    color: "#64748b",
    textTransform: "uppercase" as const,
    fontWeight: 700,
    letterSpacing: "0.05em",
  },
  statValue: {
    fontSize: "0.88rem",
    color: "#0f172a",
    fontWeight: 600,
  },
  message: {
    margin: 0,
    color: "#64748b",
    fontSize: "0.9rem",
  },
  error: {
    margin: 0,
    color: "#b91c1c",
    fontSize: "0.9rem",
  },
  emptyContainer: {
    padding: "24px",
    borderRadius: "8px",
    border: "1px dashed #cbd5e1",
    background: "#f8fafc",
    textAlign: "center" as const,
  },
  emptyText: {
    margin: 0,
    color: "#64748b",
    fontSize: "0.9rem",
  },
  courseGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: "12px",
  },
  courseCard: {
    textAlign: "left" as const,
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    padding: "14px",
    cursor: "pointer",
    transition: "transform 150ms ease, border-color 150ms ease",
    outline: "none",
    boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
    display: "flex",
    flexDirection: "column" as const,
    gap: "6px",
    ":hover": {
      borderColor: "#cbd5e1",
      transform: "translateY(-1px)",
    },
  },
  courseHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  courseCode: {
    fontSize: "0.78rem",
    fontWeight: 700,
    color: "#2563eb",
    background: "#eff6ff",
    padding: "2px 6px",
    borderRadius: "4px",
  },
  activeBadge: {
    fontSize: "0.72rem",
    fontWeight: 600,
    color: "#16a34a",
  },
  courseTitle: {
    margin: 0,
    fontSize: "0.95rem",
    fontWeight: 600,
    color: "#0f172a",
  },
  courseDesc: {
    margin: 0,
    fontSize: "0.82rem",
    color: "#64748b",
    lineHeight: 1.4,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical" as const,
    overflow: "hidden",
  },
  sectionHeading: {
    fontSize: "0.8rem",
    textTransform: "uppercase" as const,
    fontWeight: 700,
    color: "#64748b",
    letterSpacing: "0.05em",
    borderBottom: "1px solid #f1f5f9",
    paddingBottom: "4px",
    marginBottom: "6px",
  },
  rosterEmptyText: {
    margin: 0,
    fontSize: "0.88rem",
    color: "#94a3b8",
    fontStyle: "italic",
  },
  rosterList: {
    display: "grid",
    gap: "6px",
  },
  rosterItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 10px",
    borderRadius: "6px",
    background: "#f8fafc",
    border: "1px solid #f1f5f9",
    fontSize: "0.88rem",
  },
  rosterItemMain: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "2px",
  },
  rosterName: {
    fontWeight: 600,
    color: "#334155",
  },
  rosterEmail: {
    fontSize: "0.78rem",
    color: "#64748b",
  },
  rosterItemSide: {
    fontSize: "0.78rem",
    color: "#64748b",
  },
};
