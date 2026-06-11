import {
  clearAuthSession,
  getAccessToken,
  type CloudAuthSession,
} from "../auth/authStorage";

export interface CloudHealth {
  status: string;
  service: string;
  version: string;
  storageMode: string;
  timestamp: string;
}

export interface CloudSessionPayload {
  contractVersion: string;
  entityType: "SESSION_SUMMARY";
  localHubId?: string | null;
  localSessionId: string;
  sessionId?: string | null;
  deviceId?: string | null;
  manikinId?: string | null;
  courseId?: string | null;
  traineeId?: string | null;
  instructorId?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  durationMs?: number | null;
  status?: string | null;
  result?: string | null;
  totalCompressions?: number | null;
  validCompressions?: number | null;
  avgDepthMm?: number | null;
  avgRateCpm?: number | null;
  recoilOkPct?: number | null;
  recoilOkCount?: number | null;
  incompleteRecoilCount?: number | null;
  pauseCount?: number | null;
  score?: number | null;
  flags?: string | null;
  summaryNotes?: string | null;
  scenario?: string | null;
  source?: string | null;
  generatedAt?: string | null;
}

export interface CloudSessionRecord {
  cloudSessionId: string;
  idempotencyKey: string;
  payload: CloudSessionPayload;
  createdAt: string;
  updatedAt: string;
}

export type CloudUserRole = "ADMIN" | "INSTRUCTOR" | "TRAINEE";

export interface CloudUser {
  userId: string;
  displayName: string;
  email?: string | null;
  role: CloudUserRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CloudCourse {
  courseId: string;
  courseCode?: string | null;
  title: string;
  description?: string | null;
  instructorId?: string | null;
  instructorDisplayName?: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CloudEnrollment {
  enrollmentId: string;
  courseId: string;
  traineeId: string;
  traineeDisplayName: string;
  traineeEmail?: string | null;
  active: boolean;
  enrolledAt: string;
}

export interface CreateCloudUserInput {
  displayName: string;
  email?: string;
  role: CloudUserRole;
  password: string;
}

export interface UpdateCloudUserInput {
  displayName?: string;
  email?: string | null;
  role?: CloudUserRole;
  active?: boolean;
}

export interface CreateCloudCourseInput {
  courseCode?: string;
  title: string;
  description?: string;
  instructorId?: string;
}

const configuredBaseUrl = import.meta.env.VITE_CLOUD_API_BASE_URL?.trim();
export const cloudApiBaseUrl = (configuredBaseUrl || "http://localhost:19080").replace(/\/+$/, "");

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
  requiresAuth = true,
): Promise<T> {
  const accessToken = requiresAuth ? getAccessToken() : null;
  let response: Response;
  try {
    response = await fetch(`${cloudApiBaseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    const detail = error instanceof Error && error.message ? ` (${error.message})` : "";
    throw new CloudApiError(`Cloud API is unavailable. Start cloud-api and try again.${detail}`);
  }

  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 401 && accessToken) {
      clearAuthSession();
      window.history.replaceState({}, "", "/login");
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
    throw new CloudApiError(
      `Cloud API request failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
      response.status,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export function fetchCloudHealth(): Promise<CloudHealth> {
  return requestJson("/api/cloud/health", {}, false);
}

export function loginCloudUser(email: string, password: string): Promise<CloudAuthSession> {
  return requestJson("/api/cloud/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  }, false);
}

export function fetchCurrentCloudUser(): Promise<CloudUser> {
  return requestJson("/api/cloud/auth/me");
}

export function logoutCloudUser(): Promise<void> {
  return requestJson("/api/cloud/auth/logout", { method: "POST" });
}

export function fetchCloudSessions(): Promise<CloudSessionRecord[]> {
  return requestJson("/api/cloud/sessions");
}

export function fetchCloudSession(cloudSessionId: string): Promise<CloudSessionRecord> {
  return requestJson(`/api/cloud/sessions/${encodeURIComponent(cloudSessionId)}`);
}

export function fetchCloudUsers(): Promise<CloudUser[]> {
  return requestJson("/api/cloud/users");
}

export function createCloudUser(input: CreateCloudUserInput): Promise<CloudUser> {
  return requestJson("/api/cloud/users", { method: "POST", body: JSON.stringify(input) });
}

export function updateCloudUser(userId: string, patch: UpdateCloudUserInput): Promise<CloudUser> {
  return requestJson(`/api/cloud/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function updateCloudUserPassword(userId: string, password: string): Promise<void> {
  return requestJson(`/api/cloud/users/${encodeURIComponent(userId)}/password`, {
    method: "PATCH",
    body: JSON.stringify({ password }),
  });
}

export function fetchCloudCourses(): Promise<CloudCourse[]> {
  return requestJson("/api/cloud/courses");
}

export function fetchCloudCourse(courseId: string): Promise<CloudCourse> {
  return requestJson(`/api/cloud/courses/${encodeURIComponent(courseId)}`);
}

export function createCloudCourse(input: CreateCloudCourseInput): Promise<CloudCourse> {
  return requestJson("/api/cloud/courses", { method: "POST", body: JSON.stringify(input) });
}

export function updateCloudCourse(
  courseId: string,
  patch: Partial<CreateCloudCourseInput & { active: boolean; instructorId: string | null }>,
): Promise<CloudCourse> {
  return requestJson(`/api/cloud/courses/${encodeURIComponent(courseId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function fetchCourseEnrollments(courseId: string): Promise<CloudEnrollment[]> {
  return requestJson(`/api/cloud/courses/${encodeURIComponent(courseId)}/enrollments`);
}

export function enrollCloudTrainee(courseId: string, traineeId: string): Promise<CloudEnrollment> {
  return requestJson(`/api/cloud/courses/${encodeURIComponent(courseId)}/enrollments`, {
    method: "POST",
    body: JSON.stringify({ traineeId }),
  });
}

export function removeCloudEnrollment(courseId: string, traineeId: string): Promise<void> {
  return requestJson(
    `/api/cloud/courses/${encodeURIComponent(courseId)}/enrollments/${encodeURIComponent(traineeId)}`,
    { method: "DELETE" },
  );
}

export interface SessionSummaryFilters {
  courseId?: string;
  traineeId?: string;
  instructorId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

export type CloudSessionSummaryPayload = CloudSessionPayload;

export interface CloudSessionSummaryRecord {
  cloudSessionId: string;
  idempotencyKey: string;
  payload: CloudSessionSummaryPayload;
  createdAt: string;
  updatedAt: string;
}

export function listSessionSummaries(filters: SessionSummaryFilters): Promise<CloudSessionSummaryRecord[]> {
  const params = new URLSearchParams();
  
  const limit = filters.limit !== undefined ? filters.limit : 50;
  const offset = filters.offset !== undefined ? filters.offset : 0;
  
  params.append("limit", String(limit));
  params.append("offset", String(offset));

  if (filters.courseId) params.append("courseId", filters.courseId);
  if (filters.traineeId) params.append("traineeId", filters.traineeId);
  if (filters.instructorId) params.append("instructorId", filters.instructorId);
  if (filters.dateFrom) params.append("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.append("dateTo", filters.dateTo);

  const query = params.toString();
  return requestJson(`/api/cloud/session-summaries${query ? `?${query}` : ""}`);
}


export class CloudApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "CloudApiError";
  }
}
