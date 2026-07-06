package lk.resq.localhub.model.cpr;

import java.time.Instant;

public record CprSessionSummaryResponse(
        String id,
        String userId,
        String traineeId,
        String manikinId,
        Instant startedAt,
        Instant endedAt,
        long durationSeconds,
        double avgDepthMm,
        double minDepthMm,
        double maxDepthMm,
        double depthAccuracyPercent,
        double avgRateCpm,
        double rateAccuracyPercent,
        double recoilErrorPercent,
        int pauseCount,
        double longestPauseSeconds,
        double consistencyScore,
        double fatigueDropPercent,
        int overallScore,
        Instant createdAt
) {
}