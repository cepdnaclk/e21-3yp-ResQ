package lk.resq.localhub.controller;

import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;
import lk.resq.localhub.model.ApiErrorResponse;
import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.model.cpr.CprBadPerformanceSession;
import lk.resq.localhub.model.cpr.CprCoachQueryRequest;
import lk.resq.localhub.model.cpr.CprCoachQueryResponse;
import lk.resq.localhub.model.cpr.CprPerformanceAnalysis;
import lk.resq.localhub.model.cpr.CprSessionSummaryQueryRequest;
import lk.resq.localhub.model.cpr.CprSessionSummaryResponse;
import lk.resq.localhub.model.cpr.CprTrendAnalysis;
import lk.resq.localhub.model.cpr.LocalCoachRequest;
import lk.resq.localhub.model.cpr.LocalCoachResponse;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.CprPerformanceAnalyzer;
import lk.resq.localhub.service.CprTrendAnalyzer;
import lk.resq.localhub.service.ForbiddenException;
import lk.resq.localhub.service.LocalCoachResponseGenerator;
import lk.resq.localhub.service.LocalSessionRepository;

@RestController
@RequestMapping("/api/coach")
public class CprCoachController {

    private final AuthService authService;
    private final LocalSessionRepository localSessionRepository;
    private final CprPerformanceAnalyzer cprPerformanceAnalyzer;
    private final CprTrendAnalyzer cprTrendAnalyzer;
    private final LocalCoachResponseGenerator localCoachResponseGenerator;

    @Autowired
    public CprCoachController(
            AuthService authService,
            LocalSessionRepository localSessionRepository,
            CprPerformanceAnalyzer cprPerformanceAnalyzer,
            CprTrendAnalyzer cprTrendAnalyzer,
            LocalCoachResponseGenerator localCoachResponseGenerator
    ) {
        this.authService = authService;
        this.localSessionRepository = localSessionRepository;
        this.cprPerformanceAnalyzer = cprPerformanceAnalyzer;
        this.cprTrendAnalyzer = cprTrendAnalyzer;
        this.localCoachResponseGenerator = localCoachResponseGenerator;
    }

    @PostMapping("/query")
    public ResponseEntity<?> queryCoach(HttpServletRequest request, @RequestBody CprCoachQueryRequest requestBody) {
        try {
            AuthUser actor = authService.requireAuth(request);

            if (requestBody == null) {
                return ResponseEntity.badRequest().body(new ApiErrorResponse("Request body is required."));
            }

            // Validations
            if (requestBody.userId() == null || requestBody.userId().trim().isEmpty()) {
                return ResponseEntity.badRequest().body(new ApiErrorResponse("userId cannot be empty."));
            }
            if (requestBody.question() == null || requestBody.question().trim().isEmpty()) {
                return ResponseEntity.badRequest().body(new ApiErrorResponse("question cannot be empty."));
            }
            if (requestBody.fromDate() != null && requestBody.toDate() != null && requestBody.fromDate().isAfter(requestBody.toDate())) {
                return ResponseEntity.badRequest().body(new ApiErrorResponse("fromDate must be before or equal to toDate."));
            }

            // Security Check
            if (actor.role() == UserRole.TRAINEE) {
                if (!requestBody.userId().equalsIgnoreCase(actor.id()) && !requestBody.userId().equalsIgnoreCase(actor.username())) {
                    throw new ForbiddenException("You can only query your own trend history.");
                }
            }

            // Date Range Resolution
            Instant resolvedFrom = requestBody.fromDate();
            Instant resolvedTo = requestBody.toDate();
            if (resolvedFrom == null && resolvedTo == null) {
                resolvedFrom = Instant.now().minus(Duration.ofDays(21));
                resolvedTo = Instant.now();
            }

            // Fetch User Sessions
            CprSessionSummaryQueryRequest query = new CprSessionSummaryQueryRequest(
                    requestBody.userId().trim(),
                    null,
                    resolvedFrom == null ? null : resolvedFrom.toString(),
                    resolvedTo == null ? null : resolvedTo.toString(),
                    null
            );
            List<CprSessionSummaryResponse> cprSessions = localSessionRepository.findCprSessions(query);

            List<CprSessionSummaryResponse> sorted = cprSessions.stream()
                    .sorted(Comparator.comparing(CprSessionSummaryResponse::startedAt))
                    .toList();

            CprSessionSummaryResponse lastSession = sorted.isEmpty() ? null : sorted.get(sorted.size() - 1);
            CprSessionSummaryResponse bestSession = sorted.stream()
                    .max(Comparator.comparingInt(CprSessionSummaryResponse::overallScore))
                    .orElse(null);

            CprPerformanceAnalysis lastSessionAnalysis = lastSession == null ? null : cprPerformanceAnalyzer.analyze(lastSession);
            List<CprBadPerformanceSession> badSessions = cprPerformanceAnalyzer.findBadPerformanceSessions(cprSessions);
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

            CprCoachQueryResponse response = new CprCoachQueryResponse(
                    coachResponse.answer(),
                    coachResponse.mainIssues(),
                    coachResponse.recommendations(),
                    badSessions,
                    trend.trendDirection().name()
            );

            return ResponseEntity.ok(response);
        } catch (ForbiddenException error) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(error.getMessage()));
        } catch (Exception error) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(new ApiErrorResponse("Failed to generate coach response: " + error.getMessage()));
        }
    }
}
