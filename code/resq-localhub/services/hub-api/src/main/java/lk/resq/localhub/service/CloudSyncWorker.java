package lk.resq.localhub.service;

import lk.resq.localhub.config.CloudSyncProperties;
import lk.resq.localhub.model.SyncEntityType;
import lk.resq.localhub.model.SyncQueueItem;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;

@Service
public class CloudSyncWorker {

    private static final Logger logger = LoggerFactory.getLogger(CloudSyncWorker.class);

    private final CloudSyncProperties properties;
    private final SyncQueueService syncQueueService;
    private final CloudSyncGateway cloudSyncClient;

    public CloudSyncWorker(
            CloudSyncProperties properties,
            SyncQueueService syncQueueService,
            CloudSyncGateway cloudSyncClient
    ) {
        this.properties = properties;
        this.syncQueueService = syncQueueService;
        this.cloudSyncClient = cloudSyncClient;
    }

    @Scheduled(fixedDelayString = "${resq.cloud-sync.fixed-delay-ms:30000}")
    public void syncQueuedItems() {
        if (!properties.isEnabled()) {
            return;
        }

        if (!properties.isReadyForUpload()) {
            logger.warn("Cloud sync is enabled, but credentials are not fully configured (missing base-url, hub-id, or hub-key).");
            return;
        }

        try {
            List<SyncQueueItem> items = syncQueueService.findRetryableItems(
                    Instant.now(),
                    Math.max(1, properties.getBatchSize())
            );
            for (SyncQueueItem item : items) {
                processSafely(item);
            }
        } catch (Exception error) {
            logger.warn("Cloud sync run failed: {}", concise(error));
        }
    }

    void processSafely(SyncQueueItem item) {
        if (item.entityType() != SyncEntityType.SESSION_SUMMARY) {
            return;
        }

        Instant attemptedAt = Instant.now();
        String validationError = syncQueueService.getValidationError(item.payloadJson());
        if (validationError != null) {
            if (validationError.contains("local-only")) {
                syncQueueService.markSkipped(item.id(), validationError, attemptedAt);
                logger.info("Cloud sync skipped for SESSION_SUMMARY:{} because it contains local-only IDs.", item.entityId());
            } else {
                syncQueueService.markFailed(item.id(), item.retryCount() + 1, validationError, attemptedAt);
                logger.warn("Cloud sync failed for SESSION_SUMMARY:{} due to roster mismatch: {}", item.entityId(), validationError);
            }
            return;
        }

        try {
            if (!syncQueueService.markSyncing(item.id(), attemptedAt)) {
                return;
            }
            CloudSyncClient.CloudSyncResult result = cloudSyncClient.uploadSessionSummary(item.payloadJson());
            Instant syncedAt = Instant.now();
            syncQueueService.markSynced(item.id(), syncedAt);
            logger.info(
                    "Cloud sync completed for {}:{}{}",
                    item.entityType(),
                    item.entityId(),
                    result.cloudSessionId() == null ? "" : " as " + result.cloudSessionId()
            );
        } catch (Exception error) {
            recordFailure(item, attemptedAt, error);
        }
    }

    private void recordFailure(SyncQueueItem item, Instant attemptedAt, Exception error) {
        int retryCount = item.retryCount() + 1;
        String message = concise(error);
        try {
            if (retryCount >= Math.max(1, properties.getMaxRetryCount())) {
                syncQueueService.markFailed(item.id(), retryCount, message, attemptedAt);
                logger.warn("Cloud sync permanently failed for {}:{} after {} attempts: {}",
                        item.entityType(), item.entityId(), retryCount, message);
            } else {
                syncQueueService.markRetryLater(item.id(), retryCount, message, attemptedAt);
                logger.warn("Cloud sync deferred for {}:{} after attempt {}: {}",
                        item.entityType(), item.entityId(), retryCount, message);
            }
        } catch (Exception stateError) {
            logger.warn("Could not record cloud sync failure for {}:{}: {}",
                    item.entityType(), item.entityId(), concise(stateError));
        }
    }

    private static String concise(Exception error) {
        String message = error.getMessage();
        return message == null || message.isBlank()
                ? error.getClass().getSimpleName()
                : message.replaceAll("\\s+", " ").trim();
    }
}
