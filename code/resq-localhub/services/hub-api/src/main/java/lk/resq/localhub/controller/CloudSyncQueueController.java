package lk.resq.localhub.controller;

import jakarta.servlet.http.HttpServletRequest;
import lk.resq.localhub.model.ApiErrorResponse;
import lk.resq.localhub.model.SyncQueueItem;
import lk.resq.localhub.model.SyncStatus;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.CloudSyncWorker;
import lk.resq.localhub.service.SyncQueueService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api/sync/cloud/queue")
public class CloudSyncQueueController {

    private final SyncQueueService syncQueueService;
    private final CloudSyncWorker cloudSyncWorker;
    private final AuthService authService;

    public CloudSyncQueueController(
            SyncQueueService syncQueueService,
            CloudSyncWorker cloudSyncWorker,
            AuthService authService
    ) {
        this.syncQueueService = syncQueueService;
        this.cloudSyncWorker = cloudSyncWorker;
        this.authService = authService;
    }

    @PostMapping("/retry-failed")
    public ResponseEntity<?> retryFailed(HttpServletRequest request) {
        authService.requireRole(request, UserRole.ADMIN, UserRole.INSTRUCTOR);
        int count = syncQueueService.requeueAllFailed();
        if (count > 0) {
            cloudSyncWorker.syncQueuedItems();
        }
        return ResponseEntity.ok(Map.of("requeuedCount", count));
    }

    @PostMapping("/{id}/retry")
    public ResponseEntity<?> retryItem(HttpServletRequest request, @PathVariable String id) {
        authService.requireRole(request, UserRole.ADMIN, UserRole.INSTRUCTOR);
        Optional<SyncQueueItem> itemOpt = syncQueueService.findById(id);
        if (itemOpt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(new ApiErrorResponse("Sync queue item " + id + " was not found."));
        }

        SyncQueueItem item = itemOpt.get();
        if (item.syncStatus() != SyncStatus.FAILED && item.syncStatus() != SyncStatus.RETRY_LATER && item.syncStatus() != SyncStatus.SKIPPED) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(new ApiErrorResponse("Only failed, deferred, or skipped items can be retried."));
        }

        String validationError = syncQueueService.getValidationError(item.payloadJson());
        if (validationError != null) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(new ApiErrorResponse(validationError));
        }

        boolean requeued = syncQueueService.requeueItem(id);
        if (requeued) {
            cloudSyncWorker.syncQueuedItems();
            Optional<SyncQueueItem> updatedItemOpt = syncQueueService.findById(id);
            return ResponseEntity.ok(updatedItemOpt.orElse(item));
        }

        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(new ApiErrorResponse("Failed to requeue sync queue item " + id));
    }
}
