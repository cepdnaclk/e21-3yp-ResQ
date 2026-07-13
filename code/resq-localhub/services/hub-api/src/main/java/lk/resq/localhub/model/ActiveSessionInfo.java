package lk.resq.localhub.model;

import java.time.Instant;

public record ActiveSessionInfo(
        String sessionId,
        String deviceId,
        String traineeId,
        Instant startedAt,
        boolean active,
        String scenario,
        String notes,
        SessionLifecycleState lifecycleState
) {
}
