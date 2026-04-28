package lk.resq.localhub.controller;

import lk.resq.localhub.model.ApiErrorResponse;
import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.model.SessionEndRequest;
import lk.resq.localhub.model.SessionEndResponse;
import lk.resq.localhub.model.SessionStartRequest;
import lk.resq.localhub.model.SessionStartResponse;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.service.ActiveSessionService;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.ForbiddenException;
import lk.resq.localhub.service.MqttCommandPublishException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;

import java.util.NoSuchElementException;
import java.util.Map;

@RestController
@RequestMapping("/api/sessions")
public class SessionController {

    private final ActiveSessionService activeSessionService;
    private final AuthService authService;

    public SessionController(ActiveSessionService activeSessionService, AuthService authService) {
        this.activeSessionService = activeSessionService;
        this.authService = authService;
    }

    @PostMapping("/start")
    public ResponseEntity<?> startSession(HttpServletRequest request, @RequestBody SessionStartRequest requestBody) {
        try {
            AuthUser actor = authService.requireRole(request, UserRole.INSTRUCTOR);
            SessionStartResponse response = activeSessionService.startSession(requestBody);
            authService.audit(actor.id(), "START_SESSION", "session", response.sessionId(), Map.of("deviceId", response.deviceId()));
            return ResponseEntity.ok(response);
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(error.getMessage()));
        } catch (IllegalStateException error) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(new ApiErrorResponse(error.getMessage()));
        } catch (MqttCommandPublishException error) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(new ApiErrorResponse(error.getMessage()));
        }
    }

    @PostMapping("/end")
    public ResponseEntity<?> endSession(HttpServletRequest request, @RequestBody SessionEndRequest requestBody) {
        try {
            AuthUser actor = authService.requireRole(request, UserRole.INSTRUCTOR);
            SessionEndResponse response = activeSessionService.endSession(requestBody);
            authService.audit(actor.id(), "END_SESSION", "session", response.sessionId(), Map.of("deviceId", response.deviceId()));
            return ResponseEntity.ok(response);
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(error.getMessage()));
        } catch (NoSuchElementException error) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(new ApiErrorResponse(error.getMessage()));
        } catch (MqttCommandPublishException error) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(new ApiErrorResponse(error.getMessage()));
        }
    }

    @GetMapping
    public ResponseEntity<?> listSessions(HttpServletRequest request) {
        try {
            authService.requireRole(request, UserRole.INSTRUCTOR);
            return ResponseEntity.ok(activeSessionService.listCompletedSessions());
        } catch (ForbiddenException error) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        }
    }

    @GetMapping("/{sessionId}")
    public ResponseEntity<?> getSession(HttpServletRequest request, @PathVariable String sessionId) {
        try {
            AuthUser actor = authService.requireAuth(request);
            return activeSessionService.findCompletedSession(sessionId)
                    .<ResponseEntity<?>>map(session -> {
                        if (actor.role() == UserRole.TRAINEE && (session.traineeId() == null || !session.traineeId().equalsIgnoreCase(actor.username()))) {
                            throw new ForbiddenException("You can only view your own session results.");
                        }

                        return ResponseEntity.ok(session);
                    })
                    .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND)
                            .body(new ApiErrorResponse("Session " + sessionId + " was not found")));
        } catch (ForbiddenException error) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        }
    }

    @GetMapping("/live/{sessionId}")
    public ResponseEntity<?> getSessionLiveView(HttpServletRequest request, @PathVariable String sessionId) {
        try {
            AuthUser actor = authService.requireAuth(request);
            return activeSessionService.getSessionLiveView(sessionId)
                    .<ResponseEntity<?>>map(session -> {
                        if (actor.role() == UserRole.TRAINEE && (session.traineeId() == null || !session.traineeId().equalsIgnoreCase(actor.username()))) {
                            throw new ForbiddenException("You can only view your own active session.");
                        }

                        return ResponseEntity.ok(session);
                    })
                    .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND)
                            .body(new ApiErrorResponse("Session " + sessionId + " was not found or is not active")));
        } catch (ForbiddenException error) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        }
    }
}
