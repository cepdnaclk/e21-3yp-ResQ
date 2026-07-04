package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.localhub.model.SyncEntityType;
import lk.resq.localhub.model.SyncQueueItem;
import lk.resq.localhub.model.SyncStatus;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class SyncQueueServiceTest {

    private Path tempDbPath;
    private SyncQueueRepository repository;
    private SyncQueueService service;

    @BeforeEach
    void setUp() throws IOException {
        tempDbPath = Path.of("target", "sync-queue-service-test-" + UUID.randomUUID() + ".sqlite");
        Files.deleteIfExists(tempDbPath);
        repository = new SyncQueueRepository(tempDbPath.toAbsolutePath().toString());
        repository.initialize();
        service = new SyncQueueService(repository, new ObjectMapper(), new CloudSessionSummaryPayloadMapper());
    }

    @AfterEach
    void tearDown() throws IOException {
        Files.deleteIfExists(tempDbPath);
    }

    @Test
    void singleFailedOrDeferredRowCanBeRequeued() {
        String failedId = "item-failed";
        repository.save(new SyncQueueItem(
                failedId,
                SyncEntityType.SESSION_SUMMARY,
                "S-FAILED",
                "{}",
                SyncStatus.FAILED,
                5,
                "API Gateway timeout",
                Instant.now().minusSeconds(100),
                Instant.now().minusSeconds(50),
                null
        ));

        String retryLaterId = "item-retry-later";
        repository.save(new SyncQueueItem(
                retryLaterId,
                SyncEntityType.SESSION_SUMMARY,
                "S-RETRY-LATER",
                "{}",
                SyncStatus.RETRY_LATER,
                3,
                "Rate limit exceeded",
                Instant.now().minusSeconds(100),
                Instant.now().minusSeconds(50),
                null
        ));

        boolean requeuedFailed = service.requeueItem(failedId);
        boolean requeuedRetryLater = service.requeueItem(retryLaterId);

        assertThat(requeuedFailed).isTrue();
        assertThat(requeuedRetryLater).isTrue();

        Optional<SyncQueueItem> failed = service.findById(failedId);
        assertThat(failed).isPresent();
        assertThat(failed.get().syncStatus()).isEqualTo(SyncStatus.PENDING);
        assertThat(failed.get().retryCount()).isZero();
        assertThat(failed.get().lastError()).isNull();
        assertThat(failed.get().syncedAt()).isNull();

        Optional<SyncQueueItem> retryLater = service.findById(retryLaterId);
        assertThat(retryLater).isPresent();
        assertThat(retryLater.get().syncStatus()).isEqualTo(SyncStatus.PENDING);
        assertThat(retryLater.get().retryCount()).isZero();
        assertThat(retryLater.get().lastError()).isNull();
        assertThat(retryLater.get().syncedAt()).isNull();
    }

    @Test
    void successfullySyncedRowsAreNotRequeued() {
        String syncedId = "item-synced";
        repository.save(new SyncQueueItem(
                syncedId,
                SyncEntityType.SESSION_SUMMARY,
                "S-SYNCED",
                "{}",
                SyncStatus.SYNCED,
                0,
                null,
                Instant.now().minusSeconds(100),
                Instant.now().minusSeconds(50),
                Instant.now().minusSeconds(50)
        ));

        boolean requeued = service.requeueItem(syncedId);
        assertThat(requeued).isFalse();

        Optional<SyncQueueItem> stored = service.findById(syncedId);
        assertThat(stored).isPresent();
        assertThat(stored.get().syncStatus()).isEqualTo(SyncStatus.SYNCED);
    }

    @Test
    void bulkRetryOnlyAffectsFailedAndRetryLaterRows() {
        String failedId = "item-failed";
        repository.save(new SyncQueueItem(
                failedId,
                SyncEntityType.SESSION_SUMMARY,
                "S-FAILED",
                "{}",
                SyncStatus.FAILED,
                5,
                "Error 1",
                Instant.now().minusSeconds(100),
                Instant.now().minusSeconds(50),
                null
        ));

        String retryLaterId = "item-retry-later";
        repository.save(new SyncQueueItem(
                retryLaterId,
                SyncEntityType.SESSION_SUMMARY,
                "S-RETRY-LATER",
                "{}",
                SyncStatus.RETRY_LATER,
                3,
                "Error 2",
                Instant.now().minusSeconds(100),
                Instant.now().minusSeconds(50),
                null
        ));

        String syncedId = "item-synced";
        repository.save(new SyncQueueItem(
                syncedId,
                SyncEntityType.SESSION_SUMMARY,
                "S-SYNCED",
                "{}",
                SyncStatus.SYNCED,
                0,
                null,
                Instant.now().minusSeconds(100),
                Instant.now().minusSeconds(50),
                Instant.now().minusSeconds(50)
        ));

        int requeuedCount = service.requeueAllFailed();
        assertThat(requeuedCount).isEqualTo(2);

        Optional<SyncQueueItem> failed = service.findById(failedId);
        assertThat(failed).isPresent();
        assertThat(failed.get().syncStatus()).isEqualTo(SyncStatus.PENDING);

        Optional<SyncQueueItem> retryLater = service.findById(retryLaterId);
        assertThat(retryLater).isPresent();
        assertThat(retryLater.get().syncStatus()).isEqualTo(SyncStatus.PENDING);

        Optional<SyncQueueItem> synced = service.findById(syncedId);
        assertThat(synced).isPresent();
        assertThat(synced.get().syncStatus()).isEqualTo(SyncStatus.SYNCED);
    }

    @Test
    void requeueAllFailedSkipsItemsFailingValidation() {
        String invalidId = "item-invalid";
        repository.save(new SyncQueueItem(
                invalidId,
                SyncEntityType.SESSION_SUMMARY,
                "S-INVALID",
                """
                {
                  "contractVersion": "resq.cloud.session-summary.v1",
                  "entityType": "SESSION_SUMMARY",
                  "localSessionId": "S-INVALID",
                  "courseId": "smoke-course-uuid-001"
                }
                """,
                SyncStatus.FAILED,
                1,
                "some error",
                Instant.now().minusSeconds(100),
                null,
                null
        ));

        String validId = "item-valid";
        repository.save(new SyncQueueItem(
                validId,
                SyncEntityType.SESSION_SUMMARY,
                "S-VALID",
                """
                {
                  "contractVersion": "resq.cloud.session-summary.v1",
                  "entityType": "SESSION_SUMMARY",
                  "localSessionId": "S-VALID",
                  "courseId": "0d7b8ca8-ec6a-4a6e-8566-3daed313783f"
                }
                """,
                SyncStatus.FAILED,
                1,
                "some error",
                Instant.now().minusSeconds(100),
                null,
                null
        ));

        int count = service.requeueAllFailed();
        assertThat(count).isEqualTo(1);

        Optional<SyncQueueItem> invalidItem = service.findById(invalidId);
        assertThat(invalidItem).isPresent();
        assertThat(invalidItem.get().syncStatus()).isEqualTo(SyncStatus.FAILED);

        Optional<SyncQueueItem> validItem = service.findById(validId);
        assertThat(validItem).isPresent();
        assertThat(validItem.get().syncStatus()).isEqualTo(SyncStatus.PENDING);
    }
}
