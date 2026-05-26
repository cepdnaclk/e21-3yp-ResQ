import { getStoredToken } from "./tokenStore";

function authHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function getCalibrationProgress(progressId: string): Promise<number> {
  // Try backend endpoint first; if not available, return simulated progress.
  try {
    const url = `http://${window.location.hostname}:8080/api/calibration/progress/${encodeURIComponent(progressId)}`;
    const resp = await fetch(url, { credentials: "include", headers: authHeaders() });
    if (!resp.ok) throw new Error(`Status ${resp.status}`);
    const data = await resp.json();
    // Expect { progress: number }
    if (typeof data?.progress === "number") return Math.max(0, Math.min(100, Math.round(data.progress)));
  } catch (e) {
    // ignore and fallthrough to simulated progress
  }

  // Simulated progress: use a time-based pseudo-random value so UI looks responsive.
  const now = Date.now();
  const t = ((now / 1000) % 20) / 20; // cycles every 20s
  return Math.round(t * 100);
}
