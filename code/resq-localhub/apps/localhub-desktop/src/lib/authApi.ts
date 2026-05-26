import type {
  AuthBootstrapResponse,
  AuthStatusResponse,
  AuthUser,
  CreateFirstAdminRequest,
  CreateUserRequest,
  LoginRequest,
  LoginResponse,
} from "@resq/shared";
import { getStoredToken } from "./tokenStore";

export type AuthErrorResponse = {
  error: string;
};

function getAuthBaseUrl(): string {
  return `http://${window.location.hostname}:18080/api/auth`;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const data: unknown = await response.json();
  return data as T;
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const errorResponse = await readJsonResponse<AuthErrorResponse>(response).catch(() => null);
  return errorResponse?.error ?? fallback;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStoredToken();
  const response = await fetch(`${getAuthBaseUrl()}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `Request failed (${response.status})`));
  }

  return readJsonResponse<T>(response);
}

export async function fetchAuthBootstrap(): Promise<AuthBootstrapResponse> {
  return requestJson<AuthBootstrapResponse>("/bootstrap", {
    method: "GET",
  });
}

export async function fetchAuthStatus(): Promise<AuthStatusResponse> {
  return requestJson<AuthStatusResponse>("/status", {
    method: "GET",
  });
}

export async function login(request: LoginRequest): Promise<LoginResponse> {
  return requestJson<LoginResponse>("/login", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export async function setupFirstAdmin(request: CreateFirstAdminRequest): Promise<LoginResponse> {
  return requestJson<LoginResponse>("/setup", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

// Alias to match a more explicit name used in the UI code.
export async function createFirstAdmin(request: CreateFirstAdminRequest): Promise<LoginResponse> {
  return setupFirstAdmin(request);
}

export async function fetchCurrentUser(): Promise<AuthUser | null> {
  const token = getStoredToken();
  const response = await fetch(`${getAuthBaseUrl()}/me`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `Failed to load current user (${response.status})`));
  }

  return readJsonResponse<AuthUser>(response);
}

export async function logout(): Promise<void> {
  const token = getStoredToken();
  await fetch(`${getAuthBaseUrl()}/logout`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
  });
}

export async function fetchUsers(): Promise<AuthUser[]> {
  return requestJson<AuthUser[]>("/users", {
    method: "GET",
  });
}

export async function createUser(request: CreateUserRequest): Promise<AuthUser> {
  return requestJson<AuthUser>("/users", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export async function disableUser(userId: string): Promise<AuthUser> {
  return requestJson<AuthUser>(`/users/${encodeURIComponent(userId)}/disable`, {
    method: "POST",
  });
}

export async function enableUser(userId: string): Promise<AuthUser> {
  return requestJson<AuthUser>(`/users/${encodeURIComponent(userId)}/enable`, {
    method: "POST",
  });
}
