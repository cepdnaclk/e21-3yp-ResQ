package lk.resq.localhub.controller;

import jakarta.servlet.http.HttpServletRequest;
import lk.resq.localhub.model.SyncQueueItem;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.SyncQueueService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/sync-queue")
public class SyncQueueController {

    private final SyncQueueService syncQueueService;
    private final AuthService authService;

    public SyncQueueController(SyncQueueService syncQueueService, AuthService authService) {
        this.syncQueueService = syncQueueService;
        this.authService = authService;
    }

    @GetMapping
    public ResponseEntity<List<SyncQueueItem>> listRecent(HttpServletRequest request) {
        authService.requireRole(request, UserRole.INSTRUCTOR);
        return ResponseEntity.ok(syncQueueService.listRecentItems(50));
    }
}
