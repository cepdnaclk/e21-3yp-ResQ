package lk.resq.localhub.model;

import java.time.Instant;

public record SessionSummary(
        String sessionId,
        String deviceId,
        String traineeId,
        Instant startedAt,
        Instant endedAt,
        long durationSeconds,
        int sampleCount,
        int totalCompressions,
        int validCompressions,
        Double avgDepthMm,
        Double avgDepthProgress,
        Double avgRateCpm,
        Double recoilPct,
        int recoilOkCount,
        int incompleteRecoilCount,
        int pausesCount,
        int score,
        String latestFlags,
        String scoringVersion,
        Integer overallScore,
        String grade,
        Double depthScore,
        Double rateScore,
        Double recoilScore,
        Double handPlacementScore,
        Double compressionFractionScore,
        Integer scoreCap,
        String scoreCapReason,
        boolean scoreProvisional,
        int scoreValidCompressionCount,
        Double handPlacementPct,
        Double compressionFractionPct,
        String recommendation,
        String depthTarget,
        String rateTarget,
        String recoilTarget,
        String handPlacementTarget,
        String compressionFractionTarget
) {
    /** Backward-compatible constructor for persisted moderate-v0 sessions. */
    public SessionSummary(
            String sessionId, String deviceId, String traineeId,
            Instant startedAt, Instant endedAt, long durationSeconds,
            int sampleCount, int totalCompressions, int validCompressions,
            Double avgDepthMm, Double avgDepthProgress, Double avgRateCpm,
            Double recoilPct, int recoilOkCount, int incompleteRecoilCount,
            int pausesCount, int score, String latestFlags
    ) {
        this(sessionId, deviceId, traineeId, startedAt, endedAt, durationSeconds,
                sampleCount, totalCompressions, validCompressions, avgDepthMm,
                avgDepthProgress, avgRateCpm, recoilPct, recoilOkCount,
                incompleteRecoilCount, pausesCount, score, latestFlags,
                "legacy-v0", score, null, null, null, null, null, null,
                null, null, false, validCompressions, null, null, null,
                null, null, null, null, null);
    }
}
