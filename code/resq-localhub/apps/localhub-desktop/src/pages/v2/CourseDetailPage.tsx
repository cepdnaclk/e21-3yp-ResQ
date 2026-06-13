import { useEffect, useState } from "react";
import { fetchCourse, fetchCourseStudents, fetchCourseInstructors } from "../../api/coursesApi";
import type { Course, CourseStudent, CourseInstructor } from "../../types/course";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import PageHeader from "../../components/ui/PageHeader";
import LoadingState from "../../components/ui/LoadingState";

type CourseDetailPageProps = {
  courseId: string;
  onBack: () => void;
};

export function V2CourseDetailPage({ courseId, onBack }: CourseDetailPageProps) {
  const [course, setCourse] = useState<Course | null>(null);
  const [students, setStudents] = useState<CourseStudent[]>([]);
  const [instructors, setInstructors] = useState<CourseInstructor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Navigate function using popstate trigger
  const navigateTo = (path: string) => {
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  async function loadDetails() {
    setLoading(true);
    setError(null);
    try {
      const decodedId = decodeURIComponent(courseId);
      const [courseRes, studentsRes, instructorsRes] = await Promise.all([
        fetchCourse(decodedId),
        fetchCourseStudents(decodedId),
        fetchCourseInstructors(decodedId).catch(() => [] as CourseInstructor[]),
      ]);
      setCourse(courseRes);
      setStudents(studentsRes);
      setInstructors(instructorsRes);
    } catch (err) {
      setError("Students could not be loaded. Run roster sync or check course assignments.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDetails();
  }, [courseId]);

  if (loading) {
    return <LoadingState message="Loading course roster and details..." />;
  }

  if (error || !course) {
    return (
      <Card className="text-center max-w-lg mx-auto py-16 mt-8 border border-slate-100 shadow-xl">
        <div className="w-12 h-12 rounded-full bg-rose-50 border border-rose-100 flex items-center justify-center mx-auto text-rose-600 font-bold mb-4">
          !
        </div>
        <h3 className="text-lg font-bold text-slate-800">Course Roster Error</h3>
        <p className="text-sm text-slate-400 mt-1 max-w-xs mx-auto leading-relaxed">{error || "Unable to load course details."}</p>
        <Button type="button" className="mt-6 font-bold" onClick={onBack}>
          Back to Courses
        </Button>
      </Card>
    );
  }

  const resolvedCourseId = course.cloudCourseId || course.courseId || (course as any).id;

  return (
    <div className="space-y-8 max-w-5xl mx-auto select-none animate-fadeIn">
      {/* Page Header */}
      <PageHeader
        title={course.title || course.name || "Course Details"}
        subtitle={`Roster management and training launch portal for ${course.courseCode || "CPR Course"}`}
        back={{ label: "Back to Courses", onClick: onBack }}
        actions={
          <div className="flex gap-2.5">
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigateTo("/sessions")}
              className="font-bold border border-slate-200/80 bg-white"
            >
              View Recent Sessions
            </Button>
            <Button
              type="button"
              variant="primary"
              className="font-bold text-white shadow-md shadow-teal-500/10"
              onClick={() => navigateTo(`/start-session?courseId=${encodeURIComponent(resolvedCourseId)}`)}
            >
              Start Session
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Left Column: Metadata & Instructors */}
        <div className="space-y-6">
          <Card className="border border-slate-100 shadow-sm p-6 space-y-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-50 pb-2">
              Course Information
            </h3>
            <div className="space-y-3.5 text-xs text-slate-500">
              <div className="flex justify-between items-center bg-slate-50 p-2.5 rounded-xl border border-slate-100/40">
                <span className="font-semibold">Course Code:</span>
                <span className="font-bold text-slate-800 bg-teal-50 text-teal-700 px-2 py-0.5 rounded border border-teal-100 uppercase">
                  {course.courseCode || "N/A"}
                </span>
              </div>
              <div className="flex justify-between items-center bg-slate-50 p-2.5 rounded-xl border border-slate-100/40">
                <span className="font-semibold">Trainee Count:</span>
                <span className="font-bold text-slate-800">{students.length} Enrolled</span>
              </div>
              {instructors.length > 0 && (
                <div className="flex justify-between items-center bg-slate-50 p-2.5 rounded-xl border border-slate-100/40">
                  <span className="font-semibold">Instructors:</span>
                  <span className="font-bold text-slate-800">{instructors.length} Assigned</span>
                </div>
              )}
            </div>
          </Card>

          {instructors.length > 0 && (
            <Card className="border border-slate-100 shadow-sm p-6 space-y-4">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-50 pb-2">
                Assigned Instructors
              </h3>
              <div className="space-y-2">
                {instructors.map((inst) => {
                  const resolvedInstructorId = inst.cloudUserId || inst.instructorId;
                  return (
                    <div
                      key={resolvedInstructorId}
                      className="p-3 bg-slate-50/50 border border-slate-100 rounded-xl flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="font-bold text-slate-800">{inst.displayName}</div>
                        {inst.email && (
                          <div className="text-[10px] text-slate-400 mt-0.5 font-medium">{inst.email}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>

        {/* Right Column: Trainee list */}
        <div className="md:col-span-2 space-y-4">
          <Card className="border border-slate-100 shadow-sm p-6">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-50 pb-2.5 mb-4">
              Enrolled Trainees
            </h3>

            {students.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-sm font-medium">
                No trainees are enrolled in this course yet.
              </div>
            ) : (
              <div className="space-y-3">
                {students.map((student) => {
                  const resolvedTraineeId =
                    student.cloudUserId ||
                    student.traineeId ||
                    (student as any).id ||
                    (student as any).userId ||
                    (student as any).username;

                  const hasFriendlyName = student.displayName && student.displayName !== resolvedTraineeId;

                  return (
                    <div
                      key={resolvedTraineeId}
                      className="p-4 bg-white hover:bg-slate-50 border border-slate-100 rounded-2xl flex items-center justify-between gap-4 transition-colors"
                    >
                      <div>
                        <div className="font-bold text-slate-800 text-sm">{student.displayName || resolvedTraineeId}</div>
                        {student.email && (
                          <div className="text-xs text-slate-400 mt-0.5 font-medium">{student.email}</div>
                        )}
                        {!hasFriendlyName && (
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">ID: {resolvedTraineeId}</div>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        className="font-bold text-xs py-2 px-4 shadow-sm text-white shrink-0"
                        onClick={() =>
                          navigateTo(
                            `/start-session?courseId=${encodeURIComponent(
                              resolvedCourseId
                            )}&traineeId=${encodeURIComponent(resolvedTraineeId)}`
                          )
                        }
                      >
                        Start Session
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

export default V2CourseDetailPage;
