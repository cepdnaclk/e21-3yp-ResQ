/**
 * Access URL generation utilities.
 * 
 * This module provides helpers to build instructor and trainee dashboard URLs
 * from a chosen host/IP and known port numbers.
 * 
 * Keep port values in one place so they are easy to change later.
 * 
 * IMPORTANT: Both instructor and trainee dashboards are browser-safe React pages
 * served from the same Vite frontend port. They do NOT use Tauri APIs and can
 * be safely opened in any browser on the LAN.
 */

// Frontend port (Vite dev server or Tauri frontend)
// Both instructor and trainee browser-safe dashboards are served from this port
export const FRONTEND_PORT = 1420;

export interface AccessUrls {
  instructorUrl: string | null;
  traineeUrl: string | null;
}

/**
 * Generate instructor and trainee dashboard URLs from a chosen host/IP.
 * 
 * Both URLs point to the frontend port with browser-safe routes:
 * - Instructor: http://<host>:1420/instructor
 * - Trainee: http://<host>:1420/trainee
 * 
 * These routes do not depend on Tauri APIs and are safe to open in any browser.
 * 
 * @param chosenHost - The LAN IP or hostname to use. If null, returns null URLs.
 * @returns Object with instructorUrl and traineeUrl (both null if host is null)
 */
export function generateAccessUrls(chosenHost: string | null): AccessUrls {
  if (!chosenHost) {
    return {
      instructorUrl: null,
      traineeUrl: null,
    };
  }

  // Clean the host: strip trailing slashes, trim whitespace
  const cleanHost = chosenHost.trim();

  if (!cleanHost) {
    return {
      instructorUrl: null,
      traineeUrl: null,
    };
  }

  // Build instructor URL: browser-safe instructor dashboard
  const instructorUrl = `http://${cleanHost}:${FRONTEND_PORT}/instructor`;

  // Build trainee URL: browser-safe trainee dashboard (same port, different route)
  const traineeUrl = `http://${cleanHost}:${FRONTEND_PORT}/trainee`;

  return {
    instructorUrl,
    traineeUrl,
  };
}
