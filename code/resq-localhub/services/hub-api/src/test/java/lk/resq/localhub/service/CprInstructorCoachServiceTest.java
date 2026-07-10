package lk.resq.localhub.service;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import lk.resq.localhub.config.CprPerformanceAnalyzerProperties;
import lk.resq.localhub.model.cpr.CprInstructorCoachQueryRequest;
import lk.resq.localhub.model.cpr.CprInstructorCoachResponse;
import lk.resq.localhub.model.cpr.CprSessionSummaryResponse;
import lk.resq.localhub.model.cpr.CprPerformanceAnalysis;
import lk.resq.localhub.model.cpr.CprTrendAnalysis;

class CprInstructorCoachServiceTest {

    private LocalSessionRepository sessionRepository;
    private CprPerformanceAnalyzer performanceAnalyzer;
    private CprTrendAnalyzer trendAnalyzer;
    private LocalAuthRepository authRepository;
    private RosterCacheRepository rosterRepository;
    private CprInstructorCoachService service;

    @BeforeEach
    void setUp() {
        sessionRepository = mock(LocalSessionRepository.class);
        performanceAnalyzer = mock(CprPerformanceAnalyzer.class);
        trendAnalyzer = mock(CprTrendAnalyzer.class);
        authRepository = mock(LocalAuthRepository.class);
        rosterRepository = mock(RosterCacheRepository.class);

        service = new CprInstructorCoachService(
                sessionRepository,
                performanceAnalyzer,
                trendAnalyzer,
                authRepository,
                rosterRepository
        );
    }

    @Test
    void testNeedAttentionToday() {
        CprSessionSummaryResponse mockSession = new CprSessionSummaryResponse(
                "s-1", "trainee-1", "trainee-1", "M01",
                Instant.now(), Instant.now().plusSeconds(60), 60,
                42.0, 30.0, 50.0, 40.0,
                110.0, 90.0, 5.0, 1, 1.0, 80.0, 2.0, 60, Instant.now()
        );

        when(sessionRepository.findCprSessions(Mockito.any())).thenReturn(List.of(mockSession));
        when(performanceAnalyzer.analyze(Mockito.any())).thenReturn(new CprPerformanceAnalysis(
                CprPerformanceAnalysis.OverallStatus.POOR,
                List.of("Shallow compressions"),
                List.of(),
                List.of("Push deeper"),
                List.of("DEPTH_SHALLOW"),
                "Needs more practice."
        ));

        CprInstructorCoachQueryRequest req = new CprInstructorCoachQueryRequest("Which trainees need attention today?", null, null, null, null);
        CprInstructorCoachResponse response = service.generateResponse(req);

        assertThat(response.priorityTrainees()).hasSize(1);
        assertThat(response.priorityTrainees().get(0).traineeId()).isEqualTo("trainee-1");
        assertThat(response.commonIssues()).contains("Shallow compressions");
        assertThat(response.answer()).contains("trainee-1");
    }

    @Test
    void testCommonMistakes() {
        CprSessionSummaryResponse mockSession1 = new CprSessionSummaryResponse(
                "s-1", "trainee-1", "trainee-1", "M01",
                Instant.now(), Instant.now().plusSeconds(60), 60,
                52.0, 50.0, 55.0, 90.0,
                135.0, 90.0, 5.0, 1, 1.0, 80.0, 2.0, 62, Instant.now()
        );

        when(sessionRepository.findCprSessions(Mockito.any())).thenReturn(List.of(mockSession1));
        when(performanceAnalyzer.analyze(Mockito.any())).thenReturn(new CprPerformanceAnalysis(
                CprPerformanceAnalysis.OverallStatus.NEEDS_IMPROVEMENT,
                List.of("Fast compression rate"),
                List.of(),
                List.of("Slow down"),
                List.of("RATE_FAST"),
                "Needs rate adjustment."
        ));

        CprInstructorCoachQueryRequest req = new CprInstructorCoachQueryRequest("What are the common mistakes?", null, null, null, null);
        CprInstructorCoachResponse response = service.generateResponse(req);

        assertThat(response.commonIssues()).contains("Fast compression rate (average rate above target)");
        assertThat(response.answer()).contains("Fast compression rate");
    }
}
