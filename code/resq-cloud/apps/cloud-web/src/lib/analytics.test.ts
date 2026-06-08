import { computeSessionAnalytics } from "./analytics";
import type { CloudSessionRecord } from "../api/cloudApi";

test("computes analytics from available values only", () => {
  const sessions = [
    record("cloud-1", 80, 50, 100, 90),
    record("cloud-2", 100, null, 120, null),
  ];

  expect(computeSessionAnalytics(sessions)).toMatchObject({
    totalSessions: 2,
    completedSessions: 2,
    averageScore: 90,
    averageDepth: 50,
    averageRate: 110,
    averageRecoil: 90,
  });
});

function record(
  cloudSessionId: string,
  score: number,
  avgDepthMm: number | null,
  avgRateCpm: number,
  recoilOkPct: number | null,
): CloudSessionRecord {
  return {
    cloudSessionId,
    idempotencyKey: `HUB:${cloudSessionId}`,
    createdAt: "2026-06-08T08:00:00Z",
    updatedAt: "2026-06-08T08:00:00Z",
    payload: {
      contractVersion: "resq.cloud.session-summary.v1",
      entityType: "SESSION_SUMMARY",
      localSessionId: cloudSessionId,
      status: "COMPLETED",
      score,
      avgDepthMm,
      avgRateCpm,
      recoilOkPct,
    },
  };
}
