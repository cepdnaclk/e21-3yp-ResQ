package lk.resq.localhub.controller;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;

import lk.resq.localhub.model.ApiErrorResponse;
import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.model.cpr.CprCoachQueryRequest;
import lk.resq.localhub.model.cpr.CprCoachQueryResponse;
import lk.resq.localhub.model.cpr.CprSessionSummaryResponse;
import lk.resq.localhub.model.cpr.CprTrendAnalysis;
import lk.resq.localhub.model.cpr.LocalCoachResponse;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.CprPerformanceAnalyzer;
import lk.resq.localhub.service.CprTrendAnalyzer;
import lk.resq.localhub.service.LocalCoachResponseGenerator;
import lk.resq.localhub.service.LocalSessionRepository;

class CprCoachControllerTest {

    private AuthService authService;
    private LocalSessionRepository sessionRepository;
    private CprPerformanceAnalyzer performanceAnalyzer;
    private CprTrendAnalyzer trendAnalyzer;
    private LocalCoachResponseGenerator coachResponseGenerator;
    private CprCoachController controller;

    @BeforeEach
    void setUp() {
        authService = mock(AuthService.class);
        sessionRepository = mock(LocalSessionRepository.class);
        performanceAnalyzer = mock(CprPerformanceAnalyzer.class);
        trendAnalyzer = mock(CprTrendAnalyzer.class);
        coachResponseGenerator = mock(LocalCoachResponseGenerator.class);

        controller = new CprCoachController(
                authService,
                sessionRepository,
                performanceAnalyzer,
                trendAnalyzer,
                coachResponseGenerator
        );
    }

    @Test
    void validatesEmptyUserId() {
        AuthUser instructor = new AuthUser("u-1", "instructor", "Instructor", UserRole.INSTRUCTOR, null);
        when(authService.requireAuth(Mockito.any())).thenReturn(instructor);

        CprCoachQueryRequest req = new CprCoachQueryRequest("", "What should I practice next?", null, null);
        ResponseEntity<?> response = controller.queryCoach(new MockHttpServletRequest(), req);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        ApiErrorResponse body = (ApiErrorResponse) response.getBody();
        assertThat(body.error()).contains("userId cannot be empty");
    }

    @Test
    void validatesEmptyQuestion() {
        AuthUser instructor = new AuthUser("u-1", "instructor", "Instructor", UserRole.INSTRUCTOR, null);
        when(authService.requireAuth(Mockito.any())).thenReturn(instructor);

        CprCoachQueryRequest req = new CprCoachQueryRequest("user-123", "", null, null);
        ResponseEntity<?> response = controller.queryCoach(new MockHttpServletRequest(), req);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        ApiErrorResponse body = (ApiErrorResponse) response.getBody();
        assertThat(body.error()).contains("question cannot be empty");
    }

    @Test
    void validatesInvalidDateRange() {
        AuthUser instructor = new AuthUser("u-1", "instructor", "Instructor", UserRole.INSTRUCTOR, null);
        when(authService.requireAuth(Mockito.any())).thenReturn(instructor);

        Instant from = Instant.now();
        Instant to = from.minusSeconds(10);
        CprCoachQueryRequest req = new CprCoachQueryRequest("user-123", "Am I improving?", from, to);
        ResponseEntity<?> response = controller.queryCoach(new MockHttpServletRequest(), req);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        ApiErrorResponse body = (ApiErrorResponse) response.getBody();
        assertThat(body.error()).contains("fromDate must be before or equal to toDate");
    }

    @Test
    void restrictsTraineeToOwnUserId() {
        AuthUser trainee = new AuthUser("u-trainee", "trainee123", "Trainee", UserRole.TRAINEE, null);
        when(authService.requireAuth(Mockito.any())).thenReturn(trainee);

        CprCoachQueryRequest req = new CprCoachQueryRequest("other-user", "Am I improving?", null, null);
        ResponseEntity<?> response = controller.queryCoach(new MockHttpServletRequest(), req);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        ApiErrorResponse body = (ApiErrorResponse) response.getBody();
        assertThat(body.error()).contains("You can only query your own trend history");
    }

    @Test
    void returnsSuccessfulCoachResponseForValidRequest() {
        AuthUser trainee = new AuthUser("u-trainee", "trainee123", "Trainee", UserRole.TRAINEE, null);
        when(authService.requireAuth(Mockito.any())).thenReturn(trainee);

        CprSessionSummaryResponse mockSession = new CprSessionSummaryResponse(
                "session-1", "u-trainee", "Trainee", "manikin-1",
                Instant.now(), Instant.now().plusSeconds(60), 60, 52.0, 48.0, 56.0, 85.0, 110.0,
                90.0, 5.0, 1, 1.0, 82.0, 2.0, 85, Instant.now()
        );

        when(sessionRepository.findCprSessions(Mockito.any())).thenReturn(List.of(mockSession));
        when(performanceAnalyzer.findBadPerformanceSessions(Mockito.any())).thenReturn(List.of());
        when(trendAnalyzer.analyzeTrend(Mockito.any())).thenReturn(new CprTrendAnalysis(
                1, 85.0, mockSession, mockSession, CprTrendAnalysis.TrendDirection.NOT_ENOUGH_DATA,
                List.of(), List.of(), List.of(), "Baseline session"
        ));
        when(coachResponseGenerator.generateResponse(Mockito.any())).thenReturn(new LocalCoachResponse(
                "Feedback response text", List.of(), List.of("Keep practicing"), List.of()
        ));

        CprCoachQueryRequest req = new CprCoachQueryRequest("u-trainee", "Am I improving?", null, null);
        ResponseEntity<?> response = controller.queryCoach(new MockHttpServletRequest(), req);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        CprCoachQueryResponse body = (CprCoachQueryResponse) response.getBody();
        assertThat(body.answer()).isEqualTo("Feedback response text");
        assertThat(body.trendDirection()).isEqualTo("NOT_ENOUGH_DATA");
    }
}
