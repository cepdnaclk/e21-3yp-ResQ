export type ManikinLiveSummary = {
  deviceId: string;
  online: boolean;
  lastSeen: string | null;
  state: string | null;
  ip: string | null;
  fw: string | null;
  rssi: number | null;
  battery: number | null;
  sessionActive: boolean | null;
  latestDepthMm: number | null;
  latestRateCpm: number | null;
  latestRecoilOk: boolean | null;
  latestPauseS: number | null;
  latestFlags: string | null;
  lastEventType: string | null;
  activeSessionId: string | null;
  activeTraineeId: string | null;
  activeSessionStartedAt: string | null;
  activeSessionScenario: string | null;
};

function getLiveManikinsUrl(): string {
  return `http://${window.location.hostname}:18080/api/manikins/live`;
}

export function getLiveManikinsStreamUrl(): string {
  return `http://${window.location.hostname}:18080/api/stream/manikins/live`;
}

export async function fetchLiveManikins(): Promise<ManikinLiveSummary[]> {
  const response = await fetch(getLiveManikinsUrl());

  if (!response.ok) {
    throw new Error(`Failed to load live manikins (${response.status})`);
  }

  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("Invalid live manikins response");
  }

  return data as ManikinLiveSummary[];
}
