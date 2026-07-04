/**
 * exportsApi.ts — V2 export URL helpers.
 *
 * These are download URLs (browser navigation), not fetch() calls.
 * The canonical export endpoints are under /api/export/sessions/*.
 * Do NOT use /api/sessions/{id}/export?format= — that route is being deprecated.
 */

import { buildDownloadUrl } from "./localHubClient";

/** Get the JSON download URL for a completed session. */
export function getSessionJsonExportUrl(sessionId: string): string {
  return buildDownloadUrl(`/api/export/sessions/${encodeURIComponent(sessionId)}.json`);
}

/** Get the CSV download URL for a completed session. */
export function getSessionCsvExportUrl(sessionId: string): string {
  return buildDownloadUrl(`/api/export/sessions/${encodeURIComponent(sessionId)}.csv`);
}

/** Trigger a JSON download by navigating to the export URL. */
export function downloadSessionJson(sessionId: string): void {
  window.location.assign(getSessionJsonExportUrl(sessionId));
}

/** Trigger a CSV download by navigating to the export URL. */
export function downloadSessionCsv(sessionId: string): void {
  window.location.assign(getSessionCsvExportUrl(sessionId));
}
