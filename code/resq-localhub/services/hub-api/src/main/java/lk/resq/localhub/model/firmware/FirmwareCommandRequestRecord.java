package lk.resq.localhub.model.firmware;

import java.time.Instant;

public record FirmwareCommandRequestRecord(
        String requestId,
        String deviceId,
        int commandTypeId,
        String commandName,
        String topic,
        @com.fasterxml.jackson.annotation.JsonIgnore String payloadJson,
        String status,
        String replyId,
        Integer replyEventId,
        String replyStatus,
        @com.fasterxml.jackson.annotation.JsonIgnore String replyPayloadJson,
        String reasonId,
        Integer actionId,
        Instant createdAt,
        Instant publishedAt,
        Instant completedAt,
        Instant timeoutAt,
        Instant lastUpdatedAt
) {
}
