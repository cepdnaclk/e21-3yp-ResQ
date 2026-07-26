package lk.resq.localhub.model.cpr;

import java.time.Instant;

public record CprSessionSummaryRequest(
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
        String dataSource
) {
    public CprSessionSummaryRequest(
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
            int overallScore
    ) {
        this(id, userId, traineeId, manikinId, startedAt, endedAt, durationSeconds, avgDepthMm, minDepthMm, maxDepthMm,
             depthAccuracyPercent, avgRateCpm, rateAccuracyPercent, recoilErrorPercent, pauseCount,
             longestPauseSeconds, consistencyScore, fatigueDropPercent, overallScore, "REAL_SENSOR");
    }
}