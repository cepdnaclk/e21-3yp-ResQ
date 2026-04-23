package lk.resq.localhub.model;

import java.time.Instant;

public record SessionSummary(
        String sessionId,
        String deviceId,
        String traineeId,
        Instant startedAt,
        Instant endedAt,
        long durationSeconds,
        Double avgDepthMm,
        Double avgRateCpm,
        Double recoilPct,
        int pausesCount,
        int score,
        String latestFlags
) {
}