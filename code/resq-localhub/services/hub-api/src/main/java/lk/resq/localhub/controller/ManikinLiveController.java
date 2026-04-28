package lk.resq.localhub.controller;

import lk.resq.localhub.model.ManikinLiveSummary;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.service.ActiveSessionService;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.ManikinRegistryService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;

import java.util.List;

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
        authService.requireRole(request, UserRole.INSTRUCTOR);
        return manikinRegistryService.getLiveSummaries().stream()
                .map(activeSessionService::decorateLiveSummary)
                .toList();
    }

    @GetMapping("/live/{deviceId}")
    public ResponseEntity<ManikinLiveSummary> getLiveManikin(HttpServletRequest request, @PathVariable String deviceId) {
        authService.requireRole(request, UserRole.INSTRUCTOR);
        return manikinRegistryService.getLiveSummary(deviceId)
                .map(activeSessionService::decorateLiveSummary)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }
}
