package lk.resq.localhub.controller;

import lk.resq.localhub.model.ManikinLiveSummary;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.service.ActiveSessionService;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.ForbiddenException;
import lk.resq.localhub.service.ManikinRegistryService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/manikins")
public class ManikinLiveController {

    private final ManikinRegistryService manikinRegistryService;
    private final ActiveSessionService activeSessionService;
    private final AuthService authService;

    public ManikinLiveController(ManikinRegistryService manikinRegistryService, ActiveSessionService activeSessionService, AuthService authService) {
        this.manikinRegistryService = manikinRegistryService;
        this.activeSessionService = activeSessionService;
        this.authService = authService;
    }

    @GetMapping("/live")
    public List<ManikinLiveSummary> listLiveManikins(HttpServletRequest request) {
        try {
            authService.requireRole(request, UserRole.INSTRUCTOR);
            return manikinRegistryService.getLiveSummaries().stream()
                    .map(activeSessionService::decorateLiveSummary)
                    .toList();
        } catch (ForbiddenException e) {
            authService.maybeAuth(request).ifPresentOrElse(
                    user -> authService.audit(user.id(), "ACCESS_DENIED", "manikin", "list_live", Map.of()),
                    () -> authService.audit(null, "ACCESS_DENIED", "manikin", "list_live", Map.of())
            );
            throw e;
        }
    }

    @GetMapping("/live/{deviceId}")
    public ResponseEntity<ManikinLiveSummary> getLiveManikin(HttpServletRequest request, @PathVariable String deviceId) {
        try {
            authService.requireRole(request, UserRole.INSTRUCTOR);
            return manikinRegistryService.getLiveSummary(deviceId)
                    .map(activeSessionService::decorateLiveSummary)
                    .map(ResponseEntity::ok)
                    .orElseGet(() -> ResponseEntity.notFound().build());
        } catch (ForbiddenException e) {
            authService.maybeAuth(request).ifPresentOrElse(
                    user -> authService.audit(user.id(), "ACCESS_DENIED", "manikin", "get_live", Map.of("deviceId", deviceId)),
                    () -> authService.audit(null, "ACCESS_DENIED", "manikin", "get_live", Map.of("deviceId", deviceId))
            );
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
    }
}
