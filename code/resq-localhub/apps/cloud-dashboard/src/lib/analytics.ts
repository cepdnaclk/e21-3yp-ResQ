import type { CloudSessionRecord } from "../api/cloudApi";

export interface SessionAnalytics {
  totalSessions: number;
  averageScore: number | null;
  averageDepth: number | null;
  averageRate: number | null;
  averageRecoil: number | null;
  latestSyncedAt: string | null;
  completedSessions: number;
}

export function computeSessionAnalytics(sessions: CloudSessionRecord[]): SessionAnalytics {
  return {
    totalSessions: sessions.length,
    averageScore: average(sessions.map((session) => session.payload.score)),
    averageDepth: average(sessions.map((session) => session.payload.avgDepthMm)),
    averageRate: average(sessions.map((session) => session.payload.avgRateCpm)),
    averageRecoil: average(sessions.map((session) => session.payload.recoilOkPct)),
    latestSyncedAt: latestTimestamp(sessions.map((session) => session.updatedAt || session.createdAt)),
    completedSessions: sessions.filter((session) =>
      [session.payload.status, session.payload.result].some((value) => value?.toUpperCase() === "COMPLETED"),
    ).length,
  };
}

function average(values: Array<number | null | undefined>): number | null {
  const present = values.filter((value): value is number => typeof value === "number");
  if (present.length === 0) {
    return null;
  }
  return present.reduce((sum, value) => sum + value, 0) / present.length;
}

function latestTimestamp(values: string[]): string | null {
  const valid = values
    .map((value) => ({ value, time: new Date(value).getTime() }))
    .filter((entry) => !Number.isNaN(entry.time))
    .sort((a, b) => b.time - a.time);
  return valid[0]?.value ?? null;
}
