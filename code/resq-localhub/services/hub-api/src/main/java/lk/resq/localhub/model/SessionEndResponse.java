package lk.resq.localhub.model;

import java.time.Instant;

public record SessionEndResponse(
        String sessionId,
        String deviceId,
        String traineeId,
        Instant startedAt,
        boolean ended,
        Instant endedAt,
        String scenario,
        String notes,
        SessionSummary summary
) {
}
