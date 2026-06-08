import type { CloudUser } from "../api/cloudApi";

export interface CloudAuthSession {
  accessToken: string;
  expiresAt: string;
  user: CloudUser;
}

const STORAGE_KEY = "resq.cloud.auth";
export const AUTH_CHANGED_EVENT = "resq-cloud-auth-changed";

export function loadAuthSession(): CloudAuthSession | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value ? JSON.parse(value) as CloudAuthSession : null;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function getAccessToken(): string | null {
  return loadAuthSession()?.accessToken || null;
}

export function saveAuthSession(session: CloudAuthSession) {
  // Local-dev MVP only. Production should use safer browser token handling.
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

export function clearAuthSession() {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}
