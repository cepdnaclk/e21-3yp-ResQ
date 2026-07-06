package lk.resq.localhub.controller;

import lk.resq.localhub.model.ApiErrorResponse;
import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.model.SessionEndRequest;
import lk.resq.localhub.model.SessionEndResponse;
import lk.resq.localhub.model.SessionStartRequest;
import lk.resq.localhub.model.SessionStartResponse;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.config.CprPerformanceAnalyzerProperties;
import lk.resq.localhub.model.cpr.CprBadPerformanceSession;
import lk.resq.localhub.model.cpr.CprPerformanceAnalysis;
import lk.resq.localhub.model.cpr.CprSessionSummaryQueryRequest;
import lk.resq.localhub.model.cpr.CprSessionSummaryResponse;
import lk.resq.localhub.model.cpr.CprTrendAnalysis;
import lk.resq.localhub.model.cpr.LocalCoachRequest;
import lk.resq.localhub.model.cpr.LocalCoachResponse;
import lk.resq.localhub.service.ActiveSessionService;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.CprPerformanceAnalyzer;
import lk.resq.localhub.service.CprTrendAnalyzer;
import lk.resq.localhub.service.LocalCoachResponseGenerator;
import lk.resq.localhub.service.LocalSessionRepository;
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
import java.util.List;

@RestController
@RequestMapping("/api/sessions")
public class SessionController {

    private final ActiveSessionService activeSessionService;
    private final AuthService authService;
    private final ManikinRegistryService manikinRegistryService;
    private final CprTrendAnalyzer cprTrendAnalyzer;
    private final CprPerformanceAnalyzer cprPerformanceAnalyzer;
    private final LocalCoachResponseGenerator localCoachResponseGenerator;
    private final LocalSessionRepository localSessionRepository;

    public SessionController(
            ActiveSessionService activeSessionService,
            AuthService authService,
            ManikinRegistryService manikinRegistryService,
            CprTrendAnalyzer cprTrendAnalyzer,
            CprPerformanceAnalyzer cprPerformanceAnalyzer,
            LocalCoachResponseGenerator localCoachResponseGenerator,
            LocalSessionRepository localSessionRepository
    ) {
        this.activeSessionService = activeSessionService;
        this.authService = authService;
        this.manikinRegistryService = manikinRegistryService;
        this.cprTrendAnalyzer = cprTrendAnalyzer;
        this.cprPerformanceAnalyzer = cprPerformanceAnalyzer;
        this.localCoachResponseGenerator = localCoachResponseGenerator;
        this.localSessionRepository = localSessionRepository;
    }

    @PostMapping("/start")
    public ResponseEntity<?> startSession(HttpServletRequest request, @RequestBody SessionStartRequest requestBody) {
        try {
            AuthUser actor = authService.requireRole(request, UserRole.ADMIN, UserRole.INSTRUCTOR);
            SessionStartResponse response = activeSessionService.startSession(requestBody, actor);
            authService.audit(actor.id(), "SESSION_STARTED", "session", response.sessionId(), Map.of("deviceId", response.deviceId()));
            return ResponseEntity.ok(response);
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

    @GetMapping("/trends")
    public ResponseEntity<?> getTrends(
            HttpServletRequest request,
            @RequestParam(required = false) String userId,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to
    ) {
        try {
            AuthUser actor = authService.requireAuth(request);
            String targetUserId = userId;
            if (actor.role() == UserRole.TRAINEE) {
                if (userId != null && !userId.equalsIgnoreCase(actor.id()) && !userId.equalsIgnoreCase(actor.username())) {
                    throw new ForbiddenException("You can only view your own trends.");
                }
                targetUserId = actor.id();
            } else {
                if (targetUserId == null) {
                    targetUserId = actor.id();
                }
            }

            java.time.Instant fromInstant = null;
            java.time.Instant toInstant = null;
            if (from != null && !from.isBlank()) {
                fromInstant = java.time.Instant.parse(from.trim());
            }
            if (to != null && !to.isBlank()) {
                toInstant = java.time.Instant.parse(to.trim());
            }

            return ResponseEntity.ok(cprTrendAnalyzer.analyzeUserTrend(targetUserId, fromInstant, toInstant));
        } catch (ForbiddenException error) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(error.getMessage()));
        } catch (Exception error) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(new ApiErrorResponse("Failed to analyze trends: " + error.getMessage()));
        }
    }

    public record CoachAskRequest(String question) {}

    @PostMapping("/coach/ask")
    public ResponseEntity<?> askCoach(HttpServletRequest request, @RequestBody CoachAskRequest requestBody) {
        try {
            AuthUser actor = authService.requireAuth(request);
            if (requestBody == null || requestBody.question() == null) {
                return ResponseEntity.badRequest().body(new ApiErrorResponse("question is required"));
            }

            String userId = actor.id();

            // Fetch user's completed sessions
            CprSessionSummaryQueryRequest query = new CprSessionSummaryQueryRequest(userId, null, null, null, null);
            List<CprSessionSummaryResponse> cprSessions = localSessionRepository.findCprSessions(query);

            List<CprSessionSummaryResponse> sorted = cprSessions.stream()
                    .sorted(java.util.Comparator.comparing(CprSessionSummaryResponse::startedAt))
                    .toList();

            CprSessionSummaryResponse lastSession = sorted.isEmpty() ? null : sorted.get(sorted.size() - 1);
            CprSessionSummaryResponse bestSession = sorted.stream()
                    .max(java.util.Comparator.comparingInt(CprSessionSummaryResponse::overallScore))
                    .orElse(null);

            CprPerformanceAnalysis lastSessionAnalysis = lastSession == null ? null : cprPerformanceAnalyzer.analyze(lastSession);

            java.time.Instant threeWeeksAgo = java.time.Instant.now().minus(java.time.Duration.ofDays(21));
            List<CprBadPerformanceSession> badSessions = cprPerformanceAnalyzer.findBadPerformanceSessions(cprSessions).stream()
                    .filter(s -> s.sessionDateTime().isAfter(threeWeeksAgo))
                    .toList();

            CprTrendAnalysis trend = cprTrendAnalyzer.analyzeTrend(cprSessions);

            LocalCoachRequest coachRequest = new LocalCoachRequest(
                    requestBody.question(),
                    lastSessionAnalysis,
                    badSessions,
                    trend,
                    lastSession,
                    bestSession
            );

            LocalCoachResponse coachResponse = localCoachResponseGenerator.generateResponse(coachRequest);
            return ResponseEntity.ok(coachResponse);
        } catch (ForbiddenException error) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(error.getMessage()));
        } catch (Exception error) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(new ApiErrorResponse("Failed to generate coach response: " + error.getMessage()));
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
