package lk.resq.localhub.model;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record SessionStartCommandPayload(
        String sessionId,
        String deviceId,
        String traineeId,
        Instant startedAt,
        String scenario
) {
}