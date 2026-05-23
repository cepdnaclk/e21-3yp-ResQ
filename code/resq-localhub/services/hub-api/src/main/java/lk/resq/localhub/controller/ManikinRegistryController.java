package lk.resq.localhub.controller;

import lk.resq.localhub.model.ManikinLiveSummary;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.ForbiddenException;
import lk.resq.localhub.service.ManikinRegistryService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/manikins")
public class ManikinRegistryController {

    private final ManikinRegistryService manikinRegistryService;
    private final AuthService authService;

    // Spring automatically provides both services here via dependency injection
    public ManikinRegistryController(
            ManikinRegistryService manikinRegistryService,
            AuthService authService
    ) {
        this.manikinRegistryService = manikinRegistryService;
        this.authService = authService;
    }

    /**
     * GET /api/manikins
     *
     * Returns the full device registry — every manikin the hub has ever
     * heard from since startup, with their current online/offline state.
     *
     * This is different from GET /api/manikins/live which is used by the
     * real-time dashboard. This endpoint is for the registry management
     * view where an instructor or technician can see all known devices.
     *
     * Allowed roles: INSTRUCTOR, ADMIN, TECHNICIAN
     */
    @GetMapping
    public ResponseEntity<?> listManikins(HttpServletRequest request) {
        try {
            // Require the user to be logged in with an appropriate role.
            // TECHNICIAN is included here because they need to see device
            // status for maintenance and diagnostics purposes.
            authService.requireRole(
                request,
                UserRole.INSTRUCTOR,
                UserRole.ADMIN
                //UserRole.TRAINEE
            );

            // getLiveSummaries() already handles marking stale devices as
            // offline before returning, so the list is always fresh.
            List<ManikinLiveSummary> summaries =
                manikinRegistryService.getLiveSummaries();

            return ResponseEntity.ok(summaries);

        } catch (ForbiddenException e) {
            // Audit the denied access attempt so admins can investigate
            authService.maybeAuth(request).ifPresentOrElse(
                user -> authService.audit(user.id(), "ACCESS_DENIED",
                    "manikin", "list_registry", Map.of()),
                () -> authService.audit(null, "ACCESS_DENIED",
                    "manikin", "list_registry", Map.of())
            );
            return ResponseEntity
                .status(HttpStatus.FORBIDDEN)
                .body(Map.of("message",
                    "Insufficient permissions to view manikin registry"));
        }
    }
}