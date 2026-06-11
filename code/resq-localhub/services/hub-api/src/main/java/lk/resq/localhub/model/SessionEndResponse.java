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
        SessionSummary summary,
        String courseId,
        String instructorId
) {
    public SessionEndResponse(
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
        this(sessionId, deviceId, traineeId, startedAt, ended, endedAt, scenario, notes, summary, null, null);
    }
}
