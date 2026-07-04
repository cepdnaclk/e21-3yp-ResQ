package lk.resq.localhub.controller;

import jakarta.servlet.http.HttpServletRequest;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.model.cloudsync.CloudRosterResponse;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.RosterCacheRepository;
import lk.resq.localhub.service.RosterSyncService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * REST controller for monitoring and manually running the cloud roster sync pull.
 */
@RestController
@RequestMapping("/api/sync/roster")
public class RosterSyncController {

    private final RosterSyncService rosterSyncService;
    private final RosterCacheRepository rosterCacheRepository;
    private final AuthService authService;

    public RosterSyncController(
            RosterSyncService rosterSyncService,
            RosterCacheRepository rosterCacheRepository,
            AuthService authService
    ) {
        this.rosterSyncService = rosterSyncService;
        this.rosterCacheRepository = rosterCacheRepository;
        this.authService = authService;
    }

    /**
     * Get the details of the latest roster sync run.
     */
    @GetMapping("/status")
    public ResponseEntity<RosterCacheRepository.SyncStateRecord> getStatus(HttpServletRequest request) {
        authService.requireRole(request, UserRole.INSTRUCTOR);
        return ResponseEntity.ok(rosterCacheRepository.readSyncState().orElse(null));
    }

    /**
     * Manually trigger a pull of the cloud roster.
     */
    @PostMapping("/run")
    public ResponseEntity<CloudRosterResponse> triggerSync(HttpServletRequest request) throws Exception {
        authService.requireRole(request, UserRole.INSTRUCTOR);
        CloudRosterResponse response = rosterSyncService.syncRoster();
        return ResponseEntity.ok(response);
    }
}
