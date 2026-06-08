import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  enrollCloudTrainee,
  fetchCloudCourse,
  fetchCloudUsers,
  fetchCourseEnrollments,
  removeCloudEnrollment,
  type CloudCourse,
  type CloudEnrollment,
  type CloudUser,
} from "../api/cloudApi";
import { ErrorState, LoadingState } from "../components/AsyncState";
import { formatDate } from "../lib/format";
import { navigate } from "../router";

export function CourseDetailPage({
  courseId,
  readOnly = false,
}: {
  courseId: string;
  readOnly?: boolean;
}) {
  const [course, setCourse] = useState<CloudCourse | null>(null);
  const [enrollments, setEnrollments] = useState<CloudEnrollment[]>([]);
  const [users, setUsers] = useState<CloudUser[]>([]);
  const [traineeId, setTraineeId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const [courseRecord, enrollmentRecords, userRecords] = await Promise.all([
        fetchCloudCourse(courseId),
        fetchCourseEnrollments(courseId),
        fetchCloudUsers(),
      ]);
      setCourse(courseRecord);
      setEnrollments(enrollmentRecords);
      setUsers(userRecords);
    } catch (loadError) {
      setError(message(loadError));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [courseId]);

  const activeTraineeIds = useMemo(
    () => new Set(enrollments.filter((enrollment) => enrollment.active).map((enrollment) => enrollment.traineeId)),
    [enrollments],
  );
  const availableTrainees = users.filter((user) =>
    user.role === "TRAINEE" && user.active && !activeTraineeIds.has(user.userId),
  );

  async function enroll(event: FormEvent) {
    event.preventDefault();
    if (!traineeId) return;
    setIsSaving(true);
    setError(null);
    try {
      await enrollCloudTrainee(courseId, traineeId);
      setTraineeId("");
      await load();
    } catch (saveError) {
      setError(message(saveError));
    } finally {
      setIsSaving(false);
    }
  }

  async function remove(enrollment: CloudEnrollment) {
    setError(null);
    try {
      await removeCloudEnrollment(courseId, enrollment.traineeId);
      await load();
    } catch (removeError) {
      setError(message(removeError));
    }
  }

  if (isLoading && !course) return <LoadingState message="Loading course enrollment..." />;
  if (!course) return <ErrorState message={error || "Course not found."} onRetry={() => void load()} />;

  return (
    <section className="page-section">
      <button className="back-link" onClick={() => navigate("/management/courses")}>&lt;- Back to courses</button>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Course management</p>
          <h2>{course.title}</h2>
          <p>{course.courseCode || "No course code"} | {course.instructorDisplayName || "No instructor assigned"}</p>
        </div>
        <span className={course.active ? "active-badge large-badge" : "inactive-badge large-badge"}>
          {course.active ? "Active course" : "Inactive course"}
        </span>
      </div>

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <div className="course-summary">
        <div><span>Description</span><strong>{course.description || "Not recorded"}</strong></div>
        <div><span>Created</span><strong>{formatDate(course.createdAt)}</strong></div>
        <div><span>Active enrollments</span><strong>{activeTraineeIds.size}</strong></div>
      </div>

      {!readOnly ? <form className="inline-form" onSubmit={enroll}>
        <label>
          Add trainee
          <select required value={traineeId} onChange={(event) => setTraineeId(event.target.value)}>
            <option value="">Select a trainee</option>
            {availableTrainees.map((user) => (
              <option value={user.userId} key={user.userId}>
                {user.displayName}{user.email ? ` (${user.email})` : ""}
              </option>
            ))}
          </select>
        </label>
        <button className="button" disabled={isSaving || !traineeId}>
          {isSaving ? "Adding..." : "Add trainee"}
        </button>
      </form> : null}

      <div className="management-list">
        {enrollments.length === 0 ? (
          <div className="state-panel"><div><h2>No enrollments</h2><p>Add an active trainee to this course.</p></div></div>
        ) : enrollments.map((enrollment) => (
          <article className="management-row" key={enrollment.enrollmentId}>
            <div>
              <div className="row-title">
                <strong>{enrollment.traineeDisplayName}</strong>
                <span className={enrollment.active ? "active-badge" : "inactive-badge"}>
                  {enrollment.active ? "Enrolled" : "Inactive"}
                </span>
              </div>
              <p>{enrollment.traineeEmail || "No email"} | Enrolled {formatDate(enrollment.enrolledAt)}</p>
            </div>
            <div className="row-actions">
              {!readOnly && enrollment.active ? (
                <button className="text-button text-button--danger" onClick={() => void remove(enrollment)}>
                  Remove
                </button>
              ) : !readOnly ? (
                <button className="text-button" onClick={() => {
                  setTraineeId(enrollment.traineeId);
                }}>
                  Select to reactivate
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "The management request failed.";
}
