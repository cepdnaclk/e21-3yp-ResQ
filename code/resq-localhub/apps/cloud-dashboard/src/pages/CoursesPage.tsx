import { useEffect, useState, type FormEvent } from "react";
import {
  createCloudCourse,
  fetchCloudCourses,
  fetchCloudUsers,
  updateCloudCourse,
  type CloudCourse,
  type CloudUser,
} from "../api/cloudApi";
import { EmptyState, ErrorState, LoadingState } from "../components/AsyncState";
import { navigate } from "../router";

const EMPTY_FORM = { courseCode: "", title: "", description: "", instructorId: "" };

export function CoursesPage({ readOnly = false }: { readOnly?: boolean }) {
  const [courses, setCourses] = useState<CloudCourse[]>([]);
  const [users, setUsers] = useState<CloudUser[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const [courseRecords, userRecords] = await Promise.all([fetchCloudCourses(), fetchCloudUsers()]);
      setCourses(courseRecords);
      setUsers(userRecords);
    } catch (loadError) {
      setError(message(loadError));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      await createCloudCourse({
        courseCode: form.courseCode.trim() || undefined,
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        instructorId: form.instructorId || undefined,
      });
      setForm(EMPTY_FORM);
      await load();
    } catch (saveError) {
      setError(message(saveError));
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleActive(course: CloudCourse) {
    try {
      await updateCloudCourse(course.courseId, { active: !course.active });
      await load();
    } catch (updateError) {
      setError(message(updateError));
    }
  }

  if (isLoading && courses.length === 0) return <LoadingState message="Loading cloud courses..." />;
  const instructors = users.filter((user) =>
    user.active && (user.role === "INSTRUCTOR" || user.role === "ADMIN"),
  );

  return (
    <section className="page-section">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Management</p>
          <h2>Courses</h2>
          <p>Create classes, assign instructors, and open enrollment details.</p>
        </div>
      </div>

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <div className={readOnly ? "management-layout management-layout--single" : "management-layout"}>
        {!readOnly ? <form className="form-card" onSubmit={submit}>
          <div>
            <p className="eyebrow">New course</p>
            <h3>Create cloud course</h3>
          </div>
          <label>
            Course code <span>Optional</span>
            <input value={form.courseCode} onChange={(event) => setForm({ ...form, courseCode: event.target.value })} />
          </label>
          <label>
            Title
            <input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </label>
          <label>
            Description <span>Optional</span>
            <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </label>
          <label>
            Instructor <span>Optional</span>
            <select value={form.instructorId} onChange={(event) => setForm({ ...form, instructorId: event.target.value })}>
              <option value="">Unassigned</option>
              {instructors.map((user) => <option value={user.userId} key={user.userId}>{user.displayName}</option>)}
            </select>
          </label>
          <button className="button" disabled={isSaving}>{isSaving ? "Saving..." : "Create course"}</button>
        </form> : null}

        <div className="management-list">
          {courses.length === 0 ? (
            <EmptyState title="No cloud courses" message="Create a course to organize instructors and trainees." />
          ) : courses.map((course) => (
            <article className="management-row" key={course.courseId}>
              <div>
                <div className="row-title">
                  <strong>{course.title}</strong>
                  {course.courseCode ? <span className="role-badge">{course.courseCode}</span> : null}
                  <span className={course.active ? "active-badge" : "inactive-badge"}>
                    {course.active ? "Active" : "Inactive"}
                  </span>
                </div>
                <p>{course.instructorDisplayName || "No instructor assigned"}</p>
              </div>
              <div className="row-actions">
                <a
                  className="detail-link"
                  href={`/management/courses/${course.courseId}`}
                  onClick={(event) => {
                    event.preventDefault();
                    navigate(`/management/courses/${course.courseId}`);
                  }}
                >
                  View course
                </a>
                {!readOnly ? (
                  <button className="text-button" onClick={() => void toggleActive(course)}>
                    {course.active ? "Deactivate" : "Activate"}
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "The management request failed.";
}
