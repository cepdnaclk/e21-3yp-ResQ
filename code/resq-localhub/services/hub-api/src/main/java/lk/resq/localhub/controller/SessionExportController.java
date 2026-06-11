package lk.resq.localhub.controller;

import lk.resq.localhub.model.ApiErrorResponse;
import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.model.SessionEndResponse;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.service.ActiveSessionService;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.ForbiddenException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/export/sessions")
public class SessionExportController {

    private final ActiveSessionService activeSessionService;
    private final AuthService authService;

    public SessionExportController(ActiveSessionService activeSessionService, AuthService authService) {
        this.activeSessionService = activeSessionService;
        this.authService = authService;
    }

    @GetMapping(value = "/{sessionId}.json", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> exportJson(HttpServletRequest request, @PathVariable String sessionId) {
        try {
            AuthUser actor = authService.requireRole(request, UserRole.INSTRUCTOR);
            return activeSessionService.findCompletedSession(sessionId)
                    .<ResponseEntity<?>>map(session -> {
                        authService.audit(actor.id(), "SESSION_EXPORTED", "session", sessionId, Map.of("format", "json"));
                        return ResponseEntity.ok()
                                .header(HttpHeaders.CONTENT_DISPOSITION, attachmentName(sessionId, "json"))
                                .body(session);
                    })
                    .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND)
                            .body(new ApiErrorResponse("Session " + sessionId + " was not found")));
        } catch (ForbiddenException error) {
            authService.maybeAuth(request).ifPresentOrElse(
                    user -> authService.audit(user.id(), "ACCESS_DENIED", "session", "export", Map.of("sessionId", sessionId)),
                    () -> authService.audit(null, "ACCESS_DENIED", "session", "export", Map.of("sessionId", sessionId))
            );
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        }
    }

    @GetMapping(value = "/{sessionId}.csv", produces = "text/csv")
    public ResponseEntity<?> exportCsv(HttpServletRequest request, @PathVariable String sessionId) {
        try {
            AuthUser actor = authService.requireRole(request, UserRole.INSTRUCTOR);
            return activeSessionService.findCompletedSession(sessionId)
                    .<ResponseEntity<?>>map(session -> {
                        authService.audit(actor.id(), "SESSION_EXPORTED", "session", sessionId, Map.of("format", "csv"));
                        return ResponseEntity.ok()
                                .header(HttpHeaders.CONTENT_DISPOSITION, attachmentName(sessionId, "csv"))
                                .body(toCsv(List.of(session)));
                    })
                    .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND)
                            .body(new ApiErrorResponse("Session " + sessionId + " was not found")));
        } catch (ForbiddenException error) {
            authService.maybeAuth(request).ifPresentOrElse(
                    user -> authService.audit(user.id(), "ACCESS_DENIED", "session", "export", Map.of("sessionId", sessionId)),
                    () -> authService.audit(null, "ACCESS_DENIED", "session", "export", Map.of("sessionId", sessionId))
            );
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        }
    }

    private static String toCsv(List<SessionEndResponse> sessions) {
        StringBuilder builder = new StringBuilder();
        builder.append("sessionId,deviceId,traineeId,startedAt,endedAt,durationSeconds,sampleCount,totalCompressions,validCompressions,avgDepthMm,avgDepthProgress,avgRateCpm,recoilPct,recoilOkCount,incompleteRecoilCount,pausesCount,score,latestFlags\n");

        for (SessionEndResponse session : sessions) {
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
        }

        return builder.toString();
    }

    private static String csv(String value) {
        if (value == null) {
            return "";
        }

        String escaped = value.replace("\"", "\"\"");
        return '"' + escaped + '"';
    }

    private static String attachmentName(String sessionId, String extension) {
        return "attachment; filename=\"session-" + sessionId + "." + extension + "\"";
    }
}