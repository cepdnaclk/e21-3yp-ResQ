import { useState, useEffect, type FormEvent } from "react";
import { type CloudCourse, type CloudUser } from "../api/cloudApi";

export interface CourseUpdatePayload {
  courseCode: string;
  title: string;
  description: string;
  instructorId: string | null;
  active: boolean;
}

interface EditCourseModalProps {
  course: CloudCourse;
  instructors: CloudUser[];
  open: boolean;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (updates: CourseUpdatePayload) => Promise<void> | void;
}

export function EditCourseModal({
  course,
  instructors,
  open,
  loading = false,
  error = null,
  onClose,
  onSubmit,
}: EditCourseModalProps) {
  const [courseCode, setCourseCode] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [instructorId, setInstructorId] = useState("");
  const [active, setActive] = useState(true);

  const [validationError, setValidationError] = useState<string | null>(null);

  // Initialize form states when course changes or modal opens
  useEffect(() => {
    if (open && course) {
      setCourseCode(course.courseCode || "");
      setTitle(course.title || "");
      setDescription(course.description || "");
      setInstructorId(course.instructorId || "");
      setActive(course.active);
      setValidationError(null);
    }
  }, [open, course]);

  if (!open) return null;

  // Filter instructors: use only active users with role === INSTRUCTOR or ADMIN (since backend explicitly allows ADMIN too)
  const activeInstructors = instructors.filter(
    (user) => user.active && (user.role === "INSTRUCTOR" || user.role === "ADMIN")
  );

  const isCurrentInstructorInList = course.instructorId
    ? activeInstructors.some((inst) => inst.userId === course.instructorId)
    : true;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!courseCode.trim()) {
      setValidationError("Course code is required.");
      return;
    }
    if (!title.trim()) {
      setValidationError("Course title is required.");
      return;
    }
    setValidationError(null);
    onSubmit({
      courseCode: courseCode.trim(),
      title: title.trim(),
      description: description.trim(),
      instructorId: instructorId || null,
      active,
    });
  }

  const isSaveDisabled = !courseCode.trim() || !title.trim() || loading;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Course Settings</p>
            <h3>Edit Course</h3>
          </div>
          <button className="modal-close-button" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: "grid", gap: "16px" }}>
          <label className="form-card" style={{ padding: 0, border: 0, boxShadow: "none", gap: "6px" }}>
            Course Code
            <input
              type="text"
              value={courseCode}
              onChange={(e) => setCourseCode(e.target.value)}
              required
              placeholder="e.g. CPR-101"
            />
          </label>
          <label className="form-card" style={{ padding: 0, border: 0, boxShadow: "none", gap: "6px" }}>
            Title
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="e.g. Cardiopulmonary Resuscitation"
            />
          </label>
          <label className="form-card" style={{ padding: 0, border: 0, boxShadow: "none", gap: "6px" }}>
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Course description..."
            />
          </label>
          <label className="form-card" style={{ padding: 0, border: 0, boxShadow: "none", gap: "6px" }}>
            Instructor
            <select
              value={instructorId}
              onChange={(e) => setInstructorId(e.target.value)}
            >
              <option value="">Unassigned</option>
              {activeInstructors.map((user) => (
                <option value={user.userId} key={user.userId}>
                  {user.displayName}
                </option>
              ))}
              {!isCurrentInstructorInList && course.instructorId && (
                <option value={course.instructorId} disabled>
                  Current instructor unavailable
                </option>
              )}
            </select>
          </label>
          <label className="form-card" style={{ padding: 0, border: 0, boxShadow: "none", display: "flex", flexDirection: "row", alignItems: "center", gap: "10px", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              style={{ width: "auto", margin: 0 }}
            />
            <span>Active status</span>
          </label>

          {validationError ? (
            <div className="login-error" style={{ marginBottom: 0 }}>
              {validationError}
            </div>
          ) : null}

          {error ? (
            <div className="login-error" style={{ marginBottom: 0 }}>
              {error}
            </div>
          ) : null}

          <div className="modal-footer">
            <button
              type="button"
              className="button button--secondary"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button"
              disabled={isSaveDisabled}
            >
              {loading ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
