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
        String latestFlags
) {
}