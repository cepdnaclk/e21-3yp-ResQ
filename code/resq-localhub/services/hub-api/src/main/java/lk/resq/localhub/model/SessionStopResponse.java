package lk.resq.localhub.model;

import java.time.Instant;

public record SessionStopResponse(
        String sessionId,
        String deviceId,
        String requestId,
        SessionLifecycleState state,
        boolean active,
        boolean completed,
        Instant startedAt,
        Instant stopRequestedAt,
        String reason,
        String reasonId,
        Integer actionId
) {
}
