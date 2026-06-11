package lk.resq.localhub.model;

import java.time.Instant;

public record SyncQueueItem(
        String id,
        SyncEntityType entityType,
        String entityId,
        String payloadJson,
        SyncStatus syncStatus,
        int retryCount,
        String lastError,
        Instant createdAt,
        Instant lastAttemptAt,
        Instant syncedAt
) {
}
