import { beforeEach, describe, expect, it, vi } from "vitest";
import { getJson } from "./localHubClient";
import {
  fetchAuthoritativeCompletedSession,
  hasAuthoritativeScoreSummary,
} from "./sessionsApi";
import type { CompletedSession } from "../types/session";

vi.mock("./localHubClient", () => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
}));

function completed(overrides: Record<string, unknown> = {}): CompletedSession {
  return {
    sessionId: "S-1",
    deviceId: "M01",
    traineeId: "T01",
    startedAt: "2026-08-01T10:00:00Z",
    ended: true,
    endedAt: "2026-08-01T10:01:00Z",
    scenario: "Adult CPR",
    notes: null,
    summary: {
      sessionId: "S-1",
      deviceId: "M01",
      traineeId: "T01",
      startedAt: "2026-08-01T10:00:00Z",
      endedAt: "2026-08-01T10:01:00Z",
      durationSeconds: 60,
      sampleCount: 20,
      totalCompressions: 12,
      validCompressions: 12,
      avgDepthMm: 54,
      avgDepthProgress: 0.9,
      avgRateCpm: 110,
      recoilPct: 95,
      recoilOkCount: 11,
      incompleteRecoilCount: 1,
      pausesCount: 0,
      score: 0,
      latestFlags: null,
      scoringVersion: "moderate-v1",
      overallScore: 0,
      grade: "Needs practice",
      depthScore: 0,
      rateScore: 0,
      recoilScore: 0,
      handPlacementScore: 0,
      compressionFractionScore: 0,
      scoreProvisional: true,
      ...overrides,
    },
  };
}

describe("authoritative completed session reads", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T10:00:00Z"));
    vi.mocked(getJson).mockReset();
  });

  it("preserves zero, accepts persisted legacy scores, and requires every moderate-v1 field", () => {
    expect(hasAuthoritativeScoreSummary(completed())).toBe(true);
    expect(hasAuthoritativeScoreSummary(completed({ scoringVersion: "legacy-v0" }))).toBe(true);
    const missing = completed() as CompletedSession & { summary: Record<string, unknown> };
    delete missing.summary.handPlacementScore;
    expect(hasAuthoritativeScoreSummary(missing)).toBe(false);
  });

  it("retries a transient early read and stops as soon as the score is readable", async () => {
    const early = new Error("not found") as Error & { status: number };
    early.status = 404;
    vi.mocked(getJson).mockRejectedValueOnce(early).mockResolvedValueOnce(completed());

    const result = fetchAuthoritativeCompletedSession("S-1", { intervalMs: 250, timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(250);

    await expect(result).resolves.toMatchObject({ summary: { overallScore: 0 } });
    expect(getJson).toHaveBeenCalledTimes(2);
    expect(vi.mocked(getJson).mock.calls[0][0]).toBe("/api/sessions/S-1");
  });

  it("fails with an actionable error after the bounded timeout", async () => {
    vi.mocked(getJson).mockRejectedValue(new Error("not readable"));
    const result = fetchAuthoritativeCompletedSession("S-1", { intervalMs: 250, timeoutMs: 500 });
    const assertion = expect(result).rejects.toThrow(/not readable within 0.5 seconds/i);
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
    expect(getJson).toHaveBeenCalledTimes(3);
  });
});
