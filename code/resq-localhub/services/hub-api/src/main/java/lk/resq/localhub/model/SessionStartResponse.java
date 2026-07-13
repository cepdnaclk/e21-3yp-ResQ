package lk.resq.localhub.model;

import java.time.Instant;

public record SessionStartResponse(
        String sessionId,
        String deviceId,
        String traineeId,
        Instant startedAt,
        boolean active,
        String scenario,
        String notes,
        String courseId,
        String instructorId,
        String requestId,
        SessionLifecycleState state
) {
    public SessionStartResponse(
            String sessionId,
            String deviceId,
            String traineeId,
            Instant startedAt,
            boolean active,
            String scenario,
            String notes,
            String courseId,
            String instructorId
    ) {
        this(sessionId, deviceId, traineeId, startedAt, active, scenario, notes, courseId, instructorId, null,
                active ? SessionLifecycleState.ACTIVE : null);
    }

    public SessionStartResponse(
            String sessionId,
            String deviceId,
            String traineeId,
            Instant startedAt,
            boolean active,
            String scenario,
            String notes
    ) {
        this(sessionId, deviceId, traineeId, startedAt, active, scenario, notes, null, null);
    }
}
