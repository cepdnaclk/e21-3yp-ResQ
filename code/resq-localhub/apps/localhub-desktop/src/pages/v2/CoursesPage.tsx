import { useEffect, useState } from "react";
import { fetchCourses, fetchCourseStudents } from "../../api/coursesApi";
import { getRosterSyncStatus, runRosterSync, type SyncStateRecord } from "../../lib/browserRosterSyncApi";
import type { Course, CourseStudent } from "../../types/course";
import { useAuth } from "../../auth/AuthContext";
import Card, { CardHeader } from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import PageHeader from "../../components/ui/PageHeader";
import LoadingState from "../../components/ui/LoadingState";

export function CoursesPage() {
  const { currentUser } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [traineeCounts, setTraineeCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Admin roster sync state
  const [syncStatus, setSyncStatus] = useState<SyncStateRecord | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Student view modal state
  const [activeCourse, setActiveCourse] = useState<Course | null>(null);
  const [students, setStudents] = useState<CourseStudent[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [studentsError, setStudentsError] = useState<string | null>(null);

  // Page navigations
  const navigateTo = (path: string) => {
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  async function loadCoursesAndStatus() {
    setLoading(true);
    setError(null);
    try {
      const coursesRes = await fetchCourses();
      setCourses(coursesRes);

      if (currentUser?.role === "ADMIN") {
        const status = await getRosterSyncStatus();
        setSyncStatus(status);
      }

      // Fetch trainee count for each course (using cloudCourseId || courseId)
      const counts: Record<string, number> = {};
      await Promise.all(
        coursesRes.map(async (c) => {
          const resolvedCourseId = c.cloudCourseId || c.courseId || (c as any).id;
          try {
            const list = await fetchCourseStudents(resolvedCourseId);
            counts[resolvedCourseId] = list.length;
          } catch (e) {
            counts[resolvedCourseId] = 0;
          }
        })
      );
      setTraineeCounts(counts);
    } catch (err) {
      setError("Failed to retrieve classroom course rosters.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCoursesAndStatus();
  }, [currentUser]);

  async function handleSync() {
    setSyncing(true);
    try {
      await runRosterSync();
      await loadCoursesAndStatus();
    } catch (err) {
      alert("Roster sync failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSyncing(false);
    }
  }

  async function handleViewStudents(course: Course) {
    setActiveCourse(course);
    setLoadingStudents(true);
    setStudents([]);
    setStudentsError(null);
    const resolvedCourseId = course.cloudCourseId || course.courseId || (course as any).id;
    try {
      const list = await fetchCourseStudents(resolvedCourseId);
      setStudents(list);
    } catch (err) {
      console.error("Failed to load course students", err);
      setStudentsError("Students could not be loaded. Run roster sync or check course assignments.");
    } finally {
      setLoadingStudents(false);
    }
  }

  if (loading) {
    return <LoadingState message="Loading courses and rosters..." />;
  }

  const hasCourses = courses.length > 0;

  return (
    <div className="space-y-8 max-w-6xl mx-auto select-none">
      <PageHeader
        title={currentUser?.role === "ADMIN" ? "Classroom Courses & Roster" : "My Assigned Courses"}
        subtitle="Manage CPR course assignments, view student rosters, and launch training practices."
        actions={
          <Button type="button" variant="secondary" onClick={() => navigateTo("/")}>
            Back to Portal
          </Button>
        }
      />

      {/* Roster Sync Panel: ADMIN only (Correction 7 / TASK 7) */}
      {currentUser?.role === "ADMIN" ? (
        <Card className="border border-slate-100 shadow-sm p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-slate-800 text-sm leading-tight">Cloud Roster Sync</h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Pull courses, enrollments, and instructor credentials from the ResQ Cloud service.
              </p>
            </div>
            <Button
              type="button"
              variant="primary"
              disabled={syncing}
              onClick={handleSync}
              className="font-bold shrink-0 text-white"
            >
              {syncing ? "Syncing..." : "Sync roster now"}
            </Button>
          </div>

          {syncStatus && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5 bg-slate-50/50 p-4 border border-slate-100 rounded-2xl text-xs font-semibold text-slate-500">
              <div>
                <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">Last Sync Attempt</span>
                <span className="text-slate-800 text-xs mt-0.5 block">
                  {syncStatus.lastAttemptAt ? new Date(syncStatus.lastAttemptAt).toLocaleString() : "Never"}
                </span>
              </div>
              <div>
                <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">Last Sync Success</span>
                <span className="text-slate-800 text-xs mt-0.5 block">
                  {syncStatus.lastSuccessAt ? new Date(syncStatus.lastSuccessAt).toLocaleString() : "Never"}
                </span>
              </div>
              <div>
                <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">Synced Courses</span>
                <span className="text-slate-800 text-xs mt-0.5 block">{syncStatus.lastCourseCount ?? 0}</span>
              </div>
              <div>
                <span className="block text-[9px] text-slate-400 font-bold uppercase tracking-wider">Synced Enrollments</span>
                <span className="text-slate-800 text-xs mt-0.5 block">{syncStatus.lastEnrollmentCount ?? 0}</span>
              </div>
            </div>
          )}
        </Card>
      ) : (
        /* Instructor Courses sync hint if no courses found */
        !hasCourses && (
          <Card className="bg-slate-50 border border-slate-200/60 p-6 text-center text-xs font-semibold text-slate-500 max-w-lg mx-auto rounded-2xl">
            Ask the LocalHub admin to sync the roster or assign you to a course.
          </Card>
        )
      )}

      {error ? (
        <Card className="border-rose-100 bg-rose-50/50 text-rose-800 p-6 text-center max-w-lg mx-auto">
          <p className="text-sm font-semibold">{error}</p>
          <Button variant="secondary" className="mt-4 bg-white" onClick={loadCoursesAndStatus}>
            Retry Load
          </Button>
        </Card>
      ) : !hasCourses ? (
        <Card className="text-center py-20 border border-dashed border-slate-200 max-w-md mx-auto">
          <div className="text-slate-300 text-4xl mb-4 font-black">🗂</div>
          <p className="text-slate-600 text-sm font-bold">No courses assigned yet.</p>
          <p className="text-slate-400 text-xs mt-1.5 leading-relaxed">
            {currentUser?.role === "ADMIN"
              ? "Click \"Sync roster now\" to pull courses rosters from cloud."
              : "Ask the LocalHub admin to sync the roster or assign you to a course."}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-fadeIn">
          {courses.map((course) => {
            const resolvedCourseId = course.cloudCourseId || course.courseId || (course as any).id;
            const count = traineeCounts[resolvedCourseId] ?? 0;
            return (
              <Card
                key={resolvedCourseId}
                className="border border-slate-100 hover:shadow-lg transition-shadow duration-300 flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-start gap-4">
                    <span className="text-[10px] font-extrabold bg-teal-50 text-teal-700 px-2.5 py-1 rounded-full uppercase tracking-wider border border-teal-100">
                      {course.courseCode || "CPR-COURSE"}
                    </span>
                    <span className="text-xs text-slate-400 font-bold">
                      {count} {count === 1 ? "Trainee" : "Trainees"}
                    </span>
                  </div>
                  <h3 className="text-base font-black text-slate-800 mt-4 leading-snug">
                    {course.title || course.name}
                  </h3>
                </div>

                <div className="flex gap-3 pt-5 border-t border-slate-100 mt-6">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="flex-1 font-bold text-xs py-2 bg-white"
                    onClick={() => handleViewStudents(course)}
                  >
                    View Students
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    className="flex-1 font-bold text-xs py-2 shadow-md text-white"
                    onClick={() => navigateTo(`/start-session?courseId=${resolvedCourseId}`)}
                  >
                    Start Session
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Roster students modal */}
      {activeCourse && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="max-w-md w-full shadow-2xl animate-scaleUp border border-slate-100 flex flex-col max-h-[80vh]" padding="lg">
            <CardHeader
              title={`${activeCourse.courseCode || "Course"} Roster`}
              subtitle={activeCourse.title}
            />

            <div className="flex-1 overflow-y-auto mt-4 pr-1 space-y-3.5 min-h-[150px]">
              {loadingStudents ? (
                <div className="text-center py-10 text-slate-400 text-xs font-semibold">
                  Loading class list...
                </div>
              ) : studentsError ? (
                <div className="text-center py-10 text-rose-600 text-xs font-bold leading-normal">
                  {studentsError}
                </div>
              ) : students.length === 0 ? (
                <div className="text-center py-10 text-slate-400 text-xs font-medium">
                  No trainees are enrolled in this course yet.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {students.map((student) => {
                    const resolvedTraineeId =
                      student.cloudUserId ||
                      student.traineeId ||
                      (student as any).id ||
                      (student as any).userId ||
                      (student as any).username;
                    return (
                      <div
                        key={resolvedTraineeId}
                        className="p-3 bg-slate-50/50 hover:bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-between text-xs transition-colors"
                      >
                        <div>
                          <div className="font-bold text-slate-800">{student.displayName}</div>
                          {student.email && (
                            <div className="text-[10px] text-slate-400 font-medium mt-0.5">{student.email}</div>
                          )}
                        </div>
                        <div className="font-mono text-[10px] text-slate-400 font-bold select-all bg-slate-100 px-2 py-1 rounded">
                          ID: {resolvedTraineeId}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex justify-end pt-4 border-t border-slate-100 mt-4">
              <Button type="button" variant="secondary" onClick={() => {
                setActiveCourse(null);
                setStudentsError(null);
              }}>
                Close
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

export default CoursesPage;
