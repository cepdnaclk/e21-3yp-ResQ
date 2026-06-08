package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.localhub.config.CloudSyncProperties;
import lk.resq.localhub.model.SyncEntityType;
import lk.resq.localhub.model.SyncQueueItem;
import lk.resq.localhub.model.SyncStatus;
import org.junit.jupiter.api.Test;

import java.nio.file.Path;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

class CloudSyncWorkerTest {

    @Test
    void cloudSyncIsDisabledByDefaultAndDoesNotProcessItems() throws Exception {
        Fixture fixture = fixture();

        fixture.worker.syncQueuedItems();

        assertThat(fixture.item().syncStatus()).isEqualTo(SyncStatus.PENDING);
        assertThat(fixture.client.callCount).isZero();
    }

    @Test
    void successfulUploadMarksPendingItemSyncedAndSetsSyncedAt() throws Exception {
        Fixture fixture = fixture();
        fixture.properties.setEnabled(true);
        fixture.client.result = new CloudSyncClient.CloudSyncResult(201, "cloud-1", "{}");

        fixture.worker.syncQueuedItems();

        SyncQueueItem stored = fixture.item();
        assertThat(stored.syncStatus()).isEqualTo(SyncStatus.SYNCED);
        assertThat(stored.syncedAt()).isNotNull();
        assertThat(stored.lastAttemptAt()).isNotNull();
        assertThat(stored.retryCount()).isZero();
    }

    @Test
    void failedUploadIncrementsRetryCountAndMarksRetryLater() throws Exception {
        Fixture fixture = fixture();
        fixture.properties.setEnabled(true);
        fixture.client.failure = new CloudSyncClient.CloudSyncException("connection refused");

        fixture.worker.syncQueuedItems();

        SyncQueueItem stored = fixture.item();
        assertThat(stored.syncStatus()).isEqualTo(SyncStatus.RETRY_LATER);
        assertThat(stored.retryCount()).isEqualTo(1);
        assertThat(stored.lastError()).contains("connection refused");
        assertThat(stored.lastAttemptAt()).isNotNull();
        assertThat(stored.syncedAt()).isNull();
    }

    @Test
    void failureAtMaxRetryCountMarksItemFailed() throws Exception {
        Fixture fixture = fixtureWithRetryCount(2);
        fixture.properties.setEnabled(true);
        fixture.properties.setMaxRetryCount(3);
        fixture.client.failure = new CloudSyncClient.CloudSyncException("HTTP 500");

        fixture.worker.syncQueuedItems();

        SyncQueueItem stored = fixture.item();
        assertThat(stored.syncStatus()).isEqualTo(SyncStatus.FAILED);
        assertThat(stored.retryCount()).isEqualTo(3);
        assertThat(stored.lastError()).contains("HTTP 500");
    }

    @Test
    void workerSkipsItemsThatAreNotSessionSummaries() throws Exception {
        CloudSyncProperties properties = enabledProperties();
        Fixture fixture = fixture();
        FakeCloudSyncGateway client = new FakeCloudSyncGateway();
        SyncQueueItem unsupported = new SyncQueueItem(
                "unsupported",
                null,
                "entity-1",
                "{}",
                SyncStatus.PENDING,
                0,
                null,
                Instant.now(),
                null,
                null
        );
        CloudSyncWorker worker = new CloudSyncWorker(properties, fixture.service, client);

        worker.processSafely(unsupported);

        assertThat(client.callCount).isZero();
        assertThat(fixture.item().syncStatus()).isEqualTo(SyncStatus.PENDING);
    }

    @Test
    void unreachableCloudApiNeverEscapesScheduledMethod() throws Exception {
        Fixture fixture = fixture();
        fixture.properties.setEnabled(true);
        fixture.properties.setBaseUrl("http://127.0.0.1:1");
        fixture.properties.setRequestTimeoutMs(100);
        CloudSyncClient realClient = new CloudSyncClient(fixture.properties, new ObjectMapper());
        CloudSyncWorker worker = new CloudSyncWorker(fixture.properties, fixture.service, realClient);

        assertThatCode(worker::syncQueuedItems).doesNotThrowAnyException();
        assertThat(fixture.item().syncStatus()).isEqualTo(SyncStatus.RETRY_LATER);
    }

    @Test
    void retryLaterItemWaitsForBackoffBeforeBecomingRetryable() throws Exception {
        Fixture fixture = fixtureWithRetryCount(2);
        Instant attemptedAt = Instant.parse("2026-06-08T10:00:00Z");
        fixture.repository.markRetryLater(fixture.itemId, 2, "offline", attemptedAt);

        assertThat(fixture.repository.findRetryableItems(attemptedAt.plusSeconds(59), 10)).isEmpty();
        assertThat(fixture.repository.findRetryableItems(attemptedAt.plusSeconds(60), 10))
                .extracting(SyncQueueItem::id)
                .containsExactly(fixture.itemId);
    }

    private static Fixture fixture() throws Exception {
        return fixtureWithRetryCount(0);
    }

    private static Fixture fixtureWithRetryCount(int retryCount) throws Exception {
        SyncQueueRepository repository = new SyncQueueRepository(
                Path.of("target", "cloud-sync-worker-" + UUID.randomUUID() + ".sqlite").toString()
        );
        repository.initialize();
        String itemId = UUID.randomUUID().toString();
        repository.save(new SyncQueueItem(
                itemId,
                SyncEntityType.SESSION_SUMMARY,
                "S-" + UUID.randomUUID(),
                """
                        {
                          "contractVersion": "resq.cloud.session-summary.v1",
                          "entityType": "SESSION_SUMMARY",
                          "localSessionId": "S-TEST"
                        }
                        """,
                retryCount == 0 ? SyncStatus.PENDING : SyncStatus.RETRY_LATER,
                retryCount,
                retryCount == 0 ? null : "previous failure",
                Instant.now().minusSeconds(300),
                retryCount == 0 ? null : Instant.now().minusSeconds(300),
                null
        ));
        SyncQueueService service = new SyncQueueService(
                repository,
                new ObjectMapper().findAndRegisterModules(),
                new CloudSessionSummaryPayloadMapper()
        );
        CloudSyncProperties properties = new CloudSyncProperties();
        FakeCloudSyncGateway client = new FakeCloudSyncGateway();
        CloudSyncWorker worker = new CloudSyncWorker(properties, service, client);
        return new Fixture(repository, service, properties, client, worker, itemId);
    }

    private static CloudSyncProperties enabledProperties() {
        CloudSyncProperties properties = new CloudSyncProperties();
        properties.setEnabled(true);
        return properties;
    }

    private record Fixture(
            SyncQueueRepository repository,
            SyncQueueService service,
            CloudSyncProperties properties,
            FakeCloudSyncGateway client,
            CloudSyncWorker worker,
            String itemId
    ) {
        private SyncQueueItem item() {
            return repository.findRecent(10).stream()
                    .filter(candidate -> candidate.id().equals(itemId))
                    .findFirst()
                    .orElseThrow();
        }
    }

    private static final class FakeCloudSyncGateway implements CloudSyncGateway {

        private CloudSyncClient.CloudSyncResult result =
                new CloudSyncClient.CloudSyncResult(201, "cloud-test", "{}");
        private CloudSyncClient.CloudSyncException failure;
        private int callCount;

        @Override
        public CloudSyncClient.CloudSyncResult uploadSessionSummary(String payloadJson)
                throws CloudSyncClient.CloudSyncException {
            callCount++;
            if (failure != null) {
                throw failure;
            }
            return result;
        }
    }
}
