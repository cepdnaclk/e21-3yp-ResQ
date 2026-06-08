package lk.resq.cloudapi.model;

import java.time.Instant;

public record CloudSessionRecord(
        String cloudSessionId,
        String idempotencyKey,
        CloudSessionSummarySyncPayload payload,
        Instant createdAt,
        Instant updatedAt
) {
}
