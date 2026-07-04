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
import lk.resq.localhub.service.ManikinRegistryService;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;

import java.util.NoSuchElementException;
import java.util.Map;

@RestController
@RequestMapping("/api/sessions")
public class SessionController {

    private final ActiveSessionService activeSessionService;
    private final AuthService authService;
    private final ManikinRegistryService manikinRegistryService;

    public SessionController(ActiveSessionService activeSessionService, AuthService authService, ManikinRegistryService manikinRegistryService) {
        this.activeSessionService = activeSessionService;
        this.authService = authService;
        this.manikinRegistryService = manikinRegistryService;
    }

    @PostMapping("/start")
    public ResponseEntity<?> startSession(HttpServletRequest request, @RequestBody SessionStartRequest requestBody) {
        try {
            AuthUser actor = authService.requireRole(request, UserRole.ADMIN, UserRole.INSTRUCTOR);
            SessionStartResponse response = activeSessionService.startSession(requestBody, actor);
            authService.audit(actor.id(), "SESSION_STARTED", "session", response.sessionId(), Map.of("deviceId", response.deviceId()));
            return ResponseEntity.ok(response);
        } catch (lk.resq.localhub.service.CalibrationNotReadyException error) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(Map.of(
                            "error", "CALIBRATION_NOT_READY",
                            "message", error.getMessage(),
                            "deviceId", error.getDeviceId()
                    ));
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(error.getMessage()));
        } catch (NoSuchElementException error) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(new ApiErrorResponse(error.getMessage()));
        } catch (IllegalStateException error) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(new ApiErrorResponse(error.getMessage()));
        } catch (MqttCommandPublishException error) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(new ApiErrorResponse(error.getMessage()));
        } catch (ForbiddenException error) {
            authService.maybeAuth(request).ifPresentOrElse(
                    user -> authService.audit(user.id(), "ACCESS_DENIED", "session", "start", Map.of()),
                    () -> authService.audit(null, "ACCESS_DENIED", "session", "start", Map.of())
            );
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        }
    }

    @PostMapping("/end")
    public ResponseEntity<?> endSession(HttpServletRequest request, @RequestBody SessionEndRequest requestBody) {
        try {
            AuthUser actor = authService.requireRole(request, UserRole.INSTRUCTOR);
            SessionEndResponse response = activeSessionService.endSession(requestBody);
            authService.audit(actor.id(), "SESSION_ENDED", "session", response.sessionId(), Map.of("deviceId", response.deviceId()));
            return ResponseEntity.ok(response);
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(error.getMessage()));
        } catch (NoSuchElementException error) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(new ApiErrorResponse(error.getMessage()));
        } catch (MqttCommandPublishException error) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(new ApiErrorResponse(error.getMessage()));
        } catch (ForbiddenException error) {
            authService.maybeAuth(request).ifPresentOrElse(
                    user -> authService.audit(user.id(), "ACCESS_DENIED", "session", "end", Map.of()),
                    () -> authService.audit(null, "ACCESS_DENIED", "session", "end", Map.of())
            );
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        }
    }

    @GetMapping
    public ResponseEntity<?> listSessions(HttpServletRequest request) {
        try {
            authService.requireRole(request, UserRole.INSTRUCTOR);
            return ResponseEntity.ok(activeSessionService.listCompletedSessions());
        } catch (ForbiddenException error) {
            authService.maybeAuth(request).ifPresentOrElse(
                    user -> authService.audit(user.id(), "ACCESS_DENIED", "session", "list", Map.of()),
                    () -> authService.audit(null, "ACCESS_DENIED", "session", "list", Map.of())
            );
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        }
    }

    @GetMapping("/my-active")
    public ResponseEntity<?> getMyActiveSession(HttpServletRequest request) {
        try {
            AuthUser actor = authService.requireAuth(request);
            if (actor.role() != UserRole.TRAINEE) {
                throw new ForbiddenException("Only trainees can access their active session.");
            }
            return activeSessionService.findActiveSessionForTrainee(actor)
                    .<ResponseEntity<?>>map(ResponseEntity::ok)
                    .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND)
                            .body(Map.of("active", false)));
        } catch (ForbiddenException error) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        }
    }

    @GetMapping("/my-history")
    public ResponseEntity<?> getMyHistory(HttpServletRequest request) {
        try {
            AuthUser actor = authService.requireAuth(request);
            if (actor.role() != UserRole.TRAINEE) {
                throw new ForbiddenException("Only trainees can access their session history.");
            }
            return ResponseEntity.ok(activeSessionService.listCompletedSessionsForTrainee(actor));
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
                        if (actor.role() == UserRole.TRAINEE && (session.traineeId() == null || 
                            (!session.traineeId().equalsIgnoreCase(actor.id()) && 
                             !session.traineeId().equalsIgnoreCase(actor.username())))) {
                            throw new ForbiddenException("You can only view your own session results.");
                        }

                        return ResponseEntity.ok(session);
                    })
                    .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND)
                            .body(new ApiErrorResponse("Session " + sessionId + " was not found")));
        } catch (ForbiddenException error) {
            authService.maybeAuth(request).ifPresentOrElse(
                    user -> authService.audit(user.id(), "ACCESS_DENIED", "session", "get", Map.of("sessionId", sessionId)),
                    () -> authService.audit(null, "ACCESS_DENIED", "session", "get", Map.of("sessionId", sessionId))
            );
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        }
    }

    @GetMapping("/{sessionId}/export")
    public ResponseEntity<?> exportSession(HttpServletRequest request, @PathVariable String sessionId, @RequestParam(defaultValue = "json") String format) {
        try {
            AuthUser actor = authService.requireRole(request, UserRole.INSTRUCTOR);
            return activeSessionService.findCompletedSession(sessionId)
                    .<ResponseEntity<?>>map(session -> {
                        authService.audit(actor.id(), "SESSION_EXPORTED", "session", sessionId, Map.of("format", format.toLowerCase()));
                        if ("csv".equalsIgnoreCase(format)) {
                            return ResponseEntity.ok()
                                    .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"session-" + sessionId + ".csv\"")
                                    .contentType(MediaType.parseMediaType("text/csv"))
                                    .body(toCsv(session));
                        }

                        return ResponseEntity.ok()
                                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"session-" + sessionId + ".json\"")
                                .body(session);
                    })
                    .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND)
                            .body(new ApiErrorResponse("Session " + sessionId + " was not found")));
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(error.getMessage()));
        } catch (ForbiddenException error) {
            authService.maybeAuth(request).ifPresentOrElse(
                    user -> authService.audit(user.id(), "ACCESS_DENIED", "session", "export", Map.of("sessionId", sessionId)),
                    () -> authService.audit(null, "ACCESS_DENIED", "session", "export", Map.of("sessionId", sessionId))
            );
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        }
    }

    @GetMapping("/live/{sessionId}")
    public ResponseEntity<?> getSessionLiveView(HttpServletRequest request, @PathVariable String sessionId) {
        try {
            AuthUser actor = authService.requireAuth(request);
            return activeSessionService.getSessionLiveView(sessionId)
                    .or(() -> manikinRegistryService.getSessionLiveView(sessionId))
                    .<ResponseEntity<?>>map(session -> {
                        if (actor.role() == UserRole.TRAINEE && (session.traineeId() == null || 
                            (!session.traineeId().equalsIgnoreCase(actor.id()) && 
                             !session.traineeId().equalsIgnoreCase(actor.username())))) {
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

    private static String toCsv(SessionEndResponse session) {
        StringBuilder builder = new StringBuilder();
        builder.append("sessionId,deviceId,traineeId,startedAt,endedAt,durationSeconds,sampleCount,totalCompressions,validCompressions,avgDepthMm,avgDepthProgress,avgRateCpm,recoilPct,recoilOkCount,incompleteRecoilCount,pausesCount,score,latestFlags\n");
        builder.append(csv(session.sessionId())).append(',')
                .append(csv(session.deviceId())).append(',')
                .append(csv(session.traineeId())).append(',')
                .append(csv(session.startedAt().toString())).append(',')
                .append(csv(session.endedAt().toString())).append(',')
                .append(session.summary().durationSeconds()).append(',')
                .append(session.summary().sampleCount()).append(',')
                .append(session.summary().totalCompressions()).append(',')
                .append(session.summary().validCompressions()).append(',')
                .append(session.summary().avgDepthMm()).append(',')
                .append(session.summary().avgDepthProgress() == null ? "" : session.summary().avgDepthProgress()).append(',')
                .append(session.summary().avgRateCpm()).append(',')
                .append(session.summary().recoilPct()).append(',')
                .append(session.summary().recoilOkCount()).append(',')
                .append(session.summary().incompleteRecoilCount()).append(',')
                .append(session.summary().pausesCount()).append(',')
                .append(session.summary().score()).append(',')
                .append(csv(session.summary().latestFlags()))
                .append('\n');
        return builder.toString();
    }

    private static String csv(String value) {
        if (value == null) {
            return "";
        }

        return '"' + value.replace("\"", "\"\"") + '"';
    }
}
