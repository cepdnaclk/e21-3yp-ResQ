/**
 * localHubClient.ts — V2 core API fetch helper.
 *
 * Rules:
 * - Port 18080 comes from getHubApiBaseUrl() — never hardcode a port here.
 * - Auth (Bearer token) is injected globally by installHubApiFetch() in main.tsx.
 * - credentials: "include" ensures session cookies are sent.
 * - All API errors are normalized to a user-friendly string.
 */

import { getHubApiBaseUrl } from "../lib/hubApiUrl";
import type { ApiErrorResponse } from "../types/errors";

// ─────────────────────────────────────────────
// URL helpers
// ─────────────────────────────────────────────

/** Build a full hub-api URL for a given path (e.g. "/api/sessions"). */
export function buildApiUrl(path: string): string {
  const base = getHubApiBaseUrl();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

/**
 * Build a URL that will trigger a browser file download.
 * Used for JSON/CSV exports.
 */
export function buildDownloadUrl(path: string): string {
  return buildApiUrl(path);
}

// ─────────────────────────────────────────────
// Error normalization
// ─────────────────────────────────────────────

async function readErrorBody(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object") {
      const rec = body as Record<string, unknown>;
      if (typeof rec.error === "string" && rec.error.trim()) return rec.error.trim();
      if (typeof rec.message === "string" && rec.message.trim()) return rec.message.trim();
    }
  } catch {
    // ignore JSON parse failures
  }
  return httpFriendlyMessage(response.status);
}

function httpFriendlyMessage(status: number): string {
  switch (status) {
    case 400: return "The request was invalid. Please check your input and try again.";
    case 401: return "You are not signed in. Please log in and try again.";
    case 403: return "You do not have permission to perform this action.";
    case 404: return "The requested item was not found.";
    case 409: return "A conflict occurred. The item may already exist or be in use.";
    case 503: return "The training system is temporarily unavailable. Please wait and try again.";
    default:  return `Something went wrong (${status}). Please try again.`;
  }
}

// ─────────────────────────────────────────────
// Core fetch wrapper
// ─────────────────────────────────────────────

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = buildApiUrl(path);
  const response = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const message = await readErrorBody(response);
    const error = new Error(message) as Error & { status: number };
    error.status = response.status;
    throw error;
  }

  // 204 No Content — return undefined cast to T
  if (response.status === 204) {
    return undefined as unknown as T;
  }

  return response.json() as Promise<T>;
}

// ─────────────────────────────────────────────
// Public helpers
// ─────────────────────────────────────────────

export function getJson<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
  let url = path;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        params.set(key, String(value));
      }
    }
    const qs = params.toString();
    if (qs) url = `${path}?${qs}`;
  }
  return request<T>(url, { method: "GET" });
}

export function postJson<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function patchJson<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "PATCH",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function deleteJson<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}

export type { ApiErrorResponse };
