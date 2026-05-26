import { getStoredToken } from "./tokenStore";

// This file handles the manikin registry API — the management view
// that shows all known devices with their current status.
// This is separate from browserManikinsApi.ts which handles the
// real-time live stream used by the instructor dashboard tiles.

// We reuse the same shape as the live summary since the backend
// returns the same ManikinLiveSummary record for both endpoints.
export type ManikinRegistryEntry = {
  deviceId: string;
  online: boolean;
  lastSeen: string | null;   // ISO date string from the backend
  state: string | null;
  ip: string | null;
  fw: string | null;         // firmware version
  rssi: number | null;       // WiFi signal strength in dBm
  battery: number | null;
  sessionActive: boolean | null;
};

function getManikinsRegistryUrl(): string {
  return `http://${window.location.hostname}:18080/api/manikins`;
}

function authHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Fetches all known manikins from the registry.
// Unlike the live stream, this is a simple one-time fetch —
// the caller can refresh it periodically if needed.
export async function fetchManikinRegistry(): Promise<ManikinRegistryEntry[]> {
  const response = await fetch(getManikinsRegistryUrl(), {
    headers: authHeaders(),
    credentials: "include",  // sends session cookie for authentication
  });

  if (!response.ok) {
    // Extract the error message from the backend if available
    const errorData = await response.json().catch(() => null);
    throw new Error(
      errorData?.message ??
      `Failed to load manikin registry (${response.status})`
    );
  }

  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("Unexpected response format from manikin registry");
  }

  return data as ManikinRegistryEntry[];
}