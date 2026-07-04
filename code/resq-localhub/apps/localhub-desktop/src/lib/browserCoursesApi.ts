import { getHubApiBaseUrl } from "./hubApiUrl";

type JsonRecord = Record<string, unknown>;

export type CourseOption = {
  courseId: string;
  courseCode: string | null;
  title: string;
};

export type CourseStudentOption = {
  traineeId: string;
  displayName: string;
  email: string | null;
};

function getCoursesBaseUrl(): string {
  return `${getHubApiBaseUrl()}/api/courses`;
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null ? value as JsonRecord : null;
}

function firstString(record: JsonRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return null;
}

async function readError(response: Response, fallback: string): Promise<Error> {
  const payload = await response.json().catch(() => null);
  const record = asRecord(payload);
  const message = record ? firstString(record, ["error", "message"]) : null;
  return new Error(message ?? fallback);
}

export async function fetchCourses(): Promise<CourseOption[]> {
  const response = await fetch(getCoursesBaseUrl(), {
    credentials: "include",
  });

  if (!response.ok) {
    throw await readError(response, "Failed to load synced courses.");
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error("Invalid courses response.");
  }

  return payload.flatMap((value) => {
    const course = asRecord(value);
    if (!course) {
      return [];
    }

    const courseId = firstString(course, ["courseId", "cloudCourseId", "id"]);
    const title = firstString(course, ["title", "name"]);
    if (!courseId || !title) {
      return [];
    }

    return [{
      courseId,
      courseCode: firstString(course, ["courseCode", "code"]),
      title,
    }];
  });
}

export async function fetchCourseStudents(courseId: string): Promise<CourseStudentOption[]> {
  const response = await fetch(
    `${getCoursesBaseUrl()}/${encodeURIComponent(courseId)}/students`,
    { credentials: "include" },
  );

  if (!response.ok) {
    throw await readError(response, "Failed to load enrolled trainees.");
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error("Invalid course students response.");
  }

  return payload.flatMap((value) => {
    const student = asRecord(value);
    if (!student) {
      return [];
    }

    const traineeId = firstString(student, ["traineeId", "cloudUserId", "userId", "id"]);
    if (!traineeId) {
      return [];
    }

    return [{
      traineeId,
      displayName: firstString(student, ["displayName", "name", "email"]) ?? traineeId,
      email: firstString(student, ["email"]),
    }];
  });
}
