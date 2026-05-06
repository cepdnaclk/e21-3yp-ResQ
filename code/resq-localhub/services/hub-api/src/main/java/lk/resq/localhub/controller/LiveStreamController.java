package lk.resq.localhub.controller;

import lk.resq.localhub.model.SessionLiveView;
import lk.resq.localhub.service.ActiveSessionService;
import lk.resq.localhub.service.LiveStreamService;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.service.ForbiddenException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.HttpStatus;
import lk.resq.localhub.service.ManikinRegistryService;
import org.springframework.http.MediaType;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping("/api/stream")
public class LiveStreamController {

    private final LiveStreamService liveStreamService;
    private final ManikinRegistryService manikinRegistryService;
    private final ActiveSessionService activeSessionService;
    private final AuthService authService;

    public LiveStreamController(
            LiveStreamService liveStreamService,
            ManikinRegistryService manikinRegistryService,
            ActiveSessionService activeSessionService,
            AuthService authService
    ) {
        this.liveStreamService = liveStreamService;
        this.manikinRegistryService = manikinRegistryService;
        this.activeSessionService = activeSessionService;
        this.authService = authService;
    }

    @GetMapping(path = "/manikins/live", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public ResponseEntity<SseEmitter> streamManikinsLive(HttpServletRequest request) {
        try {
            authService.requireRole(request, UserRole.INSTRUCTOR);
            SseEmitter emitter = liveStreamService.subscribeInstructor(
                    manikinRegistryService.getLiveSummaries().stream()
                            .map(activeSessionService::decorateLiveSummary)
                            .toList()
            );
            return ResponseEntity.ok(emitter);
        } catch (ForbiddenException e) {
            authService.maybeAuth(request).ifPresentOrElse(
                    user -> authService.audit(user.id(), "ACCESS_DENIED", "stream", "manikins_live", Map.of()),
                    () -> authService.audit(null, "ACCESS_DENIED", "stream", "manikins_live", Map.of())
            );
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
    }

    @GetMapping(path = "/sessions/live/{sessionId}", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public ResponseEntity<SseEmitter> streamSessionLive(HttpServletRequest request, @PathVariable String sessionId) {
        try {
            // TODO: allow TRAINEE to subscribe to their own session when ownership is implemented.
            authService.requireRole(request, UserRole.INSTRUCTOR);
            SessionLiveView initialPayload = activeSessionService.getSessionLiveView(sessionId).orElse(null);
            SseEmitter emitter = liveStreamService.subscribeSession(sessionId, initialPayload);
            return ResponseEntity.ok(emitter);
        } catch (ForbiddenException e) {
            authService.maybeAuth(request).ifPresentOrElse(
                    user -> authService.audit(user.id(), "ACCESS_DENIED", "stream", "session_live", Map.of("sessionId", sessionId)),
                    () -> authService.audit(null, "ACCESS_DENIED", "stream", "session_live", Map.of("sessionId", sessionId))
            );
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
    }
}
