package lk.resq.localhub.controller;

import jakarta.servlet.http.HttpServletRequest;
import lk.resq.localhub.config.CloudSyncProperties;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.SyncQueueRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class CloudSyncStatusController {
    private final AuthService auth;
    private final CloudSyncProperties properties;
    private final SyncQueueRepository queue;
    public CloudSyncStatusController(AuthService auth, CloudSyncProperties properties, SyncQueueRepository queue) {
        this.auth = auth;
        this.properties = properties;
        this.queue = queue;
    }
    public record Status(boolean enabled, boolean configured, long pendingCount,
                         String lastSuccessAt, String lastAttemptAt, String lastError) {}

    @GetMapping("/api/sync/cloud/status")
    public Status status(HttpServletRequest request) {
        auth.requireRole(request, UserRole.ADMIN, UserRole.INSTRUCTOR);
        var state = queue.status();
        return new Status(properties.isEnabled(), properties.isReadyForUpload(), state.pendingCount(),
                state.lastSuccessAt(), state.lastAttemptAt(), state.lastError());
    }
}
