/**
 * Browser-safe health API helper.
 * 
 * This module provides a way to fetch hub health from a browser without Tauri APIs.
 * It constructs the backend URL from the current window location so it works across
 * different hosts/IPs on the LAN.
 */

export interface BrowserHealthResponse {
  ok: boolean;
  service?: string;
  timestamp?: string;
}

/**
 * Construct the backend API URL from the current window location.
 * 
 * When accessed via http://<selected-host>:1430/instructor from a browser,
 * this will construct http://<selected-host>:18080/api/hub/health
 * 
 * @returns The full health check URL
 */
function getHealthUrl(): string {
  const hostname = window.location.hostname;
  const port = 18080; // Spring Boot backend port
  const path = "/api/hub/health";
  return `http://${hostname}:${port}${path}`;
}

/**
 * Fetch hub health status from the backend using plain fetch.
 * Safe for browser/LAN access, no Tauri dependency.
 * 
 * @returns Health response or error message
 */
export async function fetchBrowserHealth(): Promise<BrowserHealthResponse> {
  const url = getHealthUrl();
  
  try {
    const response = await fetch(url);

    if (!response.ok) {
      console.warn(`Health check failed: ${response.status} ${response.statusText}`, { url });
      return {
        ok: false,
        service: undefined,
        timestamp: undefined,
      };
    }

    const data: unknown = await response.json();

    // Validate the response structure
    if (
      typeof data === "object" &&
      data !== null &&
      typeof (data as Record<string, unknown>).ok === "boolean"
    ) {
      return data as BrowserHealthResponse;
    }

    console.warn("Invalid health response format", { url, data });
    return {
      ok: false,
      service: undefined,
      timestamp: undefined,
    };
  } catch (error) {
    // Network error or CORS issue - log for debugging
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Health check error (likely CORS or network issue)", { 
      url, 
      error: errorMessage,
      hostname: window.location.hostname,
      port: window.location.port,
    });
    
    return {
      ok: false,
      service: undefined,
      timestamp: undefined,
    };
  }
}
