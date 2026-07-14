package lk.resq.localhub.model;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record SessionStartCommandPayload(
        String sessionId,
        String deviceId,
        String traineeId,
        Instant startedAt,
        String profileId,
        String scenario,
        String requestId,
        Integer profileVersion,
        String profileHash
) {
    public SessionStartCommandPayload(
            String sessionId,
            String deviceId,
            String traineeId,
            Instant startedAt,
            String profileId,
            String scenario,
            String requestId
    ) {
        this(sessionId, deviceId, traineeId, startedAt, profileId, scenario, requestId, null, null);
    }
    public SessionStartCommandPayload(
            String sessionId,
            String deviceId,
            String traineeId,
            Instant startedAt,
            String scenario,
            String requestId
    ) {
        this(sessionId, deviceId, traineeId, startedAt, null, scenario, requestId, null, null);
    }

    public SessionStartCommandPayload(
            String sessionId,
            String deviceId,
            String traineeId,
            Instant startedAt,
            String scenario
    ) {
        this(sessionId, deviceId, traineeId, startedAt, null, scenario, null, null, null);
    }
}
