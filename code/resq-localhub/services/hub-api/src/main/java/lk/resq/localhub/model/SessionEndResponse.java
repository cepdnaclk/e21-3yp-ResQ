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
        String instructorId,
        String dataSource
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
            SessionSummary summary,
            String courseId,
            String instructorId
    ) {
        this(sessionId, deviceId, traineeId, startedAt, ended, endedAt, scenario, notes, summary, courseId, instructorId, "REAL_SENSOR");
    }

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
        this(sessionId, deviceId, traineeId, startedAt, ended, endedAt, scenario, notes, summary, null, null, "REAL_SENSOR");
    }
}
