package lk.resq.localhub.model;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record SessionStopCommandPayload(
        String sessionId,
        String deviceId,
        Instant endedAt,
        String requestId
) {
    public SessionStopCommandPayload(
            String sessionId,
            String deviceId,
            Instant endedAt
    ) {
        this(sessionId, deviceId, endedAt, null);
    }
}
