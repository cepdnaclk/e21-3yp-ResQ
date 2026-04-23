package lk.resq.localhub.model;

import java.time.Instant;

public record SessionStartResponse(
        String sessionId,
        String deviceId,
        String traineeId,
        Instant startedAt,
        boolean active,
        String scenario,
        String notes
) {
}
