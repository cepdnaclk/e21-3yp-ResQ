package lk.resq.localhub.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import lk.resq.localhub.model.ApiErrorResponse;
import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.model.SyncEntityType;
import lk.resq.localhub.model.SyncQueueItem;
import lk.resq.localhub.model.SyncStatus;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.CloudSyncGateway;
import lk.resq.localhub.service.CloudSyncWorker;
import lk.resq.localhub.service.CloudSessionSummaryPayloadMapper;
import lk.resq.localhub.service.ForbiddenException;
import lk.resq.localhub.service.SyncQueueRepository;
import lk.resq.localhub.service.SyncQueueService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class CloudSyncQueueControllerTest {

    private Fixture fixture;

    @BeforeEach
    void setUp() throws Exception {
        fixture = new Fixture();
    }

    @Test
    void retryFailedReturnsCountWithoutSyncWhenNothingWasRequeued() {
        fixture.service.requeueAllFailedResult = 0;

        ResponseEntity<?> response = fixture.controller.retryFailed(null);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isEqualTo(Map.of("requeuedCount", 0));
        assertThat(fixture.worker.syncCalls).isZero();
    }

    @Test
    void retryFailedTriggersSyncWhenItemsWereRequeued() {
        fixture.service.requeueAllFailedResult = 2;

        ResponseEntity<?> response = fixture.controller.retryFailed(null);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isEqualTo(Map.of("requeuedCount", 2));
        assertThat(fixture.worker.syncCalls).isEqualTo(1);
    }

    @Test
    void retryItemReturnsNotFoundWhenItemIsMissing() {
        fixture.service.findByIdResult = Optional.empty();

        ResponseEntity<?> response = fixture.controller.retryItem(null, "missing-item");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        ApiErrorResponse body = (ApiErrorResponse) response.getBody();
        assertThat(body.error()).contains("missing-item");
    }

    @Test
    void retryItemRejectsNonRetryableStatus() {
        fixture.service.findByIdResult = Optional.of(item("item-1", SyncStatus.PENDING));

        ResponseEntity<?> response = fixture.controller.retryItem(null, "item-1");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        ApiErrorResponse body = (ApiErrorResponse) response.getBody();
        assertThat(body.error()).contains("Only failed, deferred, or skipped items can be retried");
    }

    @Test
    void retryItemRejectsValidationError() {
        fixture.service.findByIdResult = Optional.of(item("item-2", SyncStatus.FAILED));
        fixture.service.validationError = "Session contains local-only user IDs and cannot be synced to cloud.";

        ResponseEntity<?> response = fixture.controller.retryItem(null, "item-2");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        ApiErrorResponse body = (ApiErrorResponse) response.getBody();
        assertThat(body.error()).contains("local-only");
    }

    @Test
    void retryItemReturnsUpdatedItemAfterSuccessfulRequeue() {
        SyncQueueItem failed = item("item-3", SyncStatus.FAILED);
        SyncQueueItem updated = item("item-3", SyncStatus.PENDING);
        fixture.service.findByIdResult = Optional.of(failed);
        fixture.service.requeueItemResult = true;
        fixture.service.updatedItemResult = Optional.of(updated);

        ResponseEntity<?> response = fixture.controller.retryItem(null, "item-3");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isEqualTo(updated);
        assertThat(fixture.worker.syncCalls).isEqualTo(1);
    }

    @Test
    void retryItemReturnsServerErrorWhenRequeueFails() {
        fixture.service.findByIdResult = Optional.of(item("item-4", SyncStatus.FAILED));
        fixture.service.requeueItemResult = false;

        ResponseEntity<?> response = fixture.controller.retryItem(null, "item-4");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
        ApiErrorResponse body = (ApiErrorResponse) response.getBody();
        assertThat(body.error()).contains("Failed to requeue sync queue item item-4");
    }

    private static SyncQueueItem item(String id, SyncStatus status) {
        return new SyncQueueItem(
                id,
                SyncEntityType.SESSION_SUMMARY,
                "session-1",
                "{\"sessionId\":\"session-1\"}",
                status,
                0,
                null,
                Instant.parse("2026-07-29T00:00:00Z"),
                null,
                null
        );
    }

    private static final class Fixture {
        private final DummySyncQueueService service;
        private final DummyCloudSyncWorker worker;
        private final CloudSyncQueueController controller;

        private Fixture() throws Exception {
            SyncQueueRepository repository = new SyncQueueRepository(Path.of("target", "cloud-sync-queue-test-" + UUID.randomUUID() + ".sqlite").toString());
            repository.initialize();
            service = new DummySyncQueueService(repository);
            worker = new DummyCloudSyncWorker(service);
            controller = new CloudSyncQueueController(service, worker, new AllowingAuthService(new ObjectMapper()));
        }
    }

    private static final class DummySyncQueueService extends SyncQueueService {
        private int requeueAllFailedResult;
        private Optional<SyncQueueItem> findByIdResult = Optional.empty();
        private String validationError;
        private boolean requeueItemResult;
        private Optional<SyncQueueItem> updatedItemResult = Optional.empty();

        private DummySyncQueueService(SyncQueueRepository repository) {
            super(repository, new ObjectMapper(), new CloudSessionSummaryPayloadMapper());
        }

        @Override
        public int requeueAllFailed() {
            return requeueAllFailedResult;
        }

        @Override
        public Optional<SyncQueueItem> findById(String id) {
            return findByIdResult;
        }

        @Override
        public String getValidationError(String payloadJson) {
            return validationError;
        }

        @Override
        public boolean requeueItem(String id) {
            if (requeueItemResult) {
                findByIdResult = updatedItemResult;
            }
            return requeueItemResult;
        }
    }

    private static final class DummyCloudSyncWorker extends CloudSyncWorker {
        private int syncCalls;

        private DummyCloudSyncWorker(DummySyncQueueService service) {
            super(new lk.resq.localhub.config.CloudSyncProperties(), service, payloadJson -> new lk.resq.localhub.service.CloudSyncClient.CloudSyncResult(200, null, "{}"));
        }

        @Override
        public void syncQueuedItems() {
            syncCalls++;
        }
    }

    private static final class AllowingAuthService extends AuthService {
        private UserRole role = UserRole.ADMIN;

        private AllowingAuthService(ObjectMapper objectMapper) throws Exception {
            super(new lk.resq.localhub.service.LocalAuthRepository(Path.of("target", "cloud-sync-queue-auth-" + UUID.randomUUID() + ".sqlite").toString()), objectMapper, 8);
        }

        @Override
        public AuthUser requireRole(HttpServletRequest request, UserRole... allowedRoles) {
            for (UserRole allowedRole : allowedRoles) {
                if (allowedRole == role) {
                    return new AuthUser("admin-1", "admin", "Admin", role, null);
                }
            }
            throw new ForbiddenException("Access denied");
        }

        @Override
        public java.util.Optional<AuthUser> maybeAuth(HttpServletRequest request) {
            return java.util.Optional.of(new AuthUser("admin-1", "admin", "Admin", role, null));
        }

        @Override
        public void audit(String actorUserId, String action, String targetType, String targetId, Map<String, Object> metadata) {
        }
    }
}