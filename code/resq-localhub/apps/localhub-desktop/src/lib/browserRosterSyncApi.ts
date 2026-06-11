/**
 * browserRosterSyncApi.ts
 *
 * Frontend-only HTTP client for:
 *   - Roster sync status & manual trigger
 *   - Course directory (list + detail)
 *   - Course instructors
 *   - Course students (role-checked at the call-site — TRAINEE must never call listCourseStudents)
 *
 * ⚠️  The backend-to-backend sync endpoint GET /api/sync/roster is intentionally
 *     NEVER called here. Only POST /api/sync/roster/run (manual trigger) and
 *     GET /api/sync/roster/status are exposed.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type SyncStatusResponse = {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastUserCount: number | null;
  lastCourseCount: number | null;
  lastEnrollmentCount: number | null;
  /** True when backend sync credentials are missing/incomplete */
  credentialsMissing?: boolean;
};

export type SyncRunResponse = {
  ok: boolean;
  message?: string;
};

export type CourseView = {
  cloudCourseId: string;
  courseCode: string | null;
  title: string;
  description: string | null;
  /** Formatted label: "courseCode / title" or just title if no code */
  label?: string;
};

export type CourseInstructorView = {
  cloudUserId: string;
  displayName: string;
  email: string | null;
  username?: string | null;
};

export type CourseStudentView = {
  cloudUserId: string;
  displayName: string;
  email: string | null;
  username?: string | null;
  enrollmentStatus?: string | null;
};

type ApiErrorResponse = { error: string };

// ─── Base URLs ────────────────────────────────────────────────────────────────

function getSyncBaseUrl(): string {
  return `http://${window.location.hostname}:18080/api/sync/roster`;
}

function getCoursesBaseUrl(): string {
  return `http://${window.location.hostname}:18080/api/courses`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function readJson<T>(response: Response): Promise<T> {
  const data: unknown = await response.json();
  return data as T;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });

  if (!response.ok) {
    const err = await readJson<ApiErrorResponse>(response).catch(() => null);
    throw new Error(err?.error ?? `Request failed (${response.status})`);
  }

  return readJson<T>(response);
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const err = await readJson<ApiErrorResponse>(response).catch(() => null);
    throw new Error(err?.error ?? `Request failed (${response.status})`);
  }

  return readJson<T>(response);
}

function buildCourseLabel(course: Omit<CourseView, "label">): string {
  if (course.courseCode) {
    return `${course.courseCode} / ${course.title}`;
  }
  return course.title;
}

function normalizeCourse(raw: CourseView): CourseView {
  return { ...raw, label: buildCourseLabel(raw) };
}

// ─── Roster Sync API ──────────────────────────────────────────────────────────

/**
 * Fetch the current roster sync status metadata.
 * Maps to GET /api/sync/roster/status
 */
export async function fetchSyncStatus(): Promise<SyncStatusResponse> {
  return getJson<SyncStatusResponse>(`${getSyncBaseUrl()}/status`);
}

/**
 * Manually trigger a roster sync run.
 * Maps to POST /api/sync/roster/run
 * ⚠️  Only the ADMIN role should ever call this from the UI.
 */
export async function triggerRosterSync(): Promise<SyncRunResponse> {
  return postJson<SyncRunResponse>(`${getSyncBaseUrl()}/run`);
}

// ─── Courses API ──────────────────────────────────────────────────────────────

/**
 * List all courses available to the current user.
 * Maps to GET /api/courses
 * The backend already filters based on the session user's role.
 */
export async function listCourses(): Promise<CourseView[]> {
  const data = await getJson<CourseView[]>(getCoursesBaseUrl());
  if (!Array.isArray(data)) return [];
  return data.map(normalizeCourse);
}

/**
 * Fetch a single course by ID.
 * Maps to GET /api/courses/{courseId}
 */
export async function getCourse(courseId: string): Promise<CourseView> {
  const data = await getJson<CourseView>(
    `${getCoursesBaseUrl()}/${encodeURIComponent(courseId)}`
  );
  return normalizeCourse(data);
}

/**
 * List instructors assigned to a course.
 * Maps to GET /api/courses/{courseId}/instructors
 * Safe for ADMIN, INSTRUCTOR, and TRAINEE roles.
 */
export async function listCourseInstructors(
  courseId: string
): Promise<CourseInstructorView[]> {
  const data = await getJson<CourseInstructorView[]>(
    `${getCoursesBaseUrl()}/${encodeURIComponent(courseId)}/instructors`
  );
  if (!Array.isArray(data)) return [];
  return data;
}

/**
 * List students enrolled in a course.
 * Maps to GET /api/courses/{courseId}/students
 *
 * ⚠️  TRAINEE role must NEVER call this function.
 *     Role enforcement is the responsibility of the call-site.
 */
export async function listCourseStudents(
  courseId: string
): Promise<CourseStudentView[]> {
  const data = await getJson<CourseStudentView[]>(
    `${getCoursesBaseUrl()}/${encodeURIComponent(courseId)}/students`
  );
  if (!Array.isArray(data)) return [];
  return data;
}
