import { getHubApiBaseUrl } from "./hubApiUrl";
import { getStoredToken } from "./tokenStore";

export interface SyncStateRecord {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastUserCount: number | null;
  lastCourseCount: number | null;
  lastEnrollmentCount: number | null;
}

export interface CourseView {
  cloudCourseId: string;
  courseCode: string | null;
  title: string;
  description: string | null;
  instructorCloudUserId: string | null;
  active: boolean;
}

export interface CourseStudentView {
  cloudUserId: string;
  displayName: string;
  email: string | null;
  enrolledAt: string | null;
}

export interface CourseInstructorView {
  cloudUserId: string;
  displayName: string;
  email: string | null;
}

function getBaseUrl(): string {
  return `${getHubApiBaseUrl()}/api`;
}

function getHeaders(): HeadersInit {
  const token = getStoredToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function getRosterSyncStatus(): Promise<SyncStateRecord | null> {
  const response = await fetch(`${getBaseUrl()}/sync/roster/status`, {
    headers: getHeaders(),
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Failed to get roster sync status: ${response.statusText}`);
  }
  return response.json();
}

export async function runRosterSync(): Promise<any> {
  const response = await fetch(`${getBaseUrl()}/sync/roster/run`, {
    method: "POST",
    headers: getHeaders(),
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Failed to trigger roster sync: ${response.statusText}`);
  }
  return response.json();
}

export async function listCourses(): Promise<CourseView[]> {
  const response = await fetch(`${getBaseUrl()}/courses`, {
    headers: getHeaders(),
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Failed to list courses: ${response.statusText}`);
  }
  return response.json();
}

export async function getCourse(courseId: string): Promise<CourseView> {
  const response = await fetch(`${getBaseUrl()}/courses/${encodeURIComponent(courseId)}`, {
    headers: getHeaders(),
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Failed to get course ${courseId}: ${response.statusText}`);
  }
  return response.json();
}

export async function listCourseStudents(courseId: string): Promise<CourseStudentView[]> {
  const response = await fetch(`${getBaseUrl()}/courses/${encodeURIComponent(courseId)}/students`, {
    headers: getHeaders(),
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Failed to list students for course ${courseId}: ${response.statusText}`);
  }
  return response.json();
}

export async function listCourseInstructors(courseId: string): Promise<CourseInstructorView[]> {
  const response = await fetch(`${getBaseUrl()}/courses/${encodeURIComponent(courseId)}/instructors`, {
    headers: getHeaders(),
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Failed to list instructors for course ${courseId}: ${response.statusText}`);
  }
  return response.json();
}
