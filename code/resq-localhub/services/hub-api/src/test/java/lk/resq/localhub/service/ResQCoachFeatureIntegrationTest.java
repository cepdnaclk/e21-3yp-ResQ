package lk.resq.localhub.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import lk.resq.localhub.config.CprPerformanceAnalyzerProperties;
import lk.resq.localhub.model.SessionEndResponse;
import lk.resq.localhub.model.SessionSummary;
import lk.resq.localhub.model.cpr.CprBadPerformanceSession;
import lk.resq.localhub.model.cpr.CprPerformanceAnalysis;
import lk.resq.localhub.model.cpr.CprSessionSummaryQueryRequest;
import lk.resq.localhub.model.cpr.CprSessionSummaryResponse;
import lk.resq.localhub.model.cpr.CprTrendAnalysis;
import lk.resq.localhub.model.cpr.LocalCoachRequest;
import lk.resq.localhub.model.cpr.LocalCoachResponse;

class ResQCoachFeatureIntegrationTest {

    private Path tempDbPath;
    private LocalSessionRepository sessionRepository;
    private CprPerformanceAnalyzerProperties properties;
    private CprPerformanceAnalyzer performanceAnalyzer;
    private CprTrendAnalyzer trendAnalyzer;
    private LocalCoachResponseGenerator coachResponseGenerator;

    @BeforeEach
    void setUp() throws IOException {
        tempDbPath = Files.createTempFile("resq-coach-integration-", ".sqlite");
        sessionRepository = new LocalSessionRepository(tempDbPath.toString());
        sessionRepository.initialize();

        properties = new CprPerformanceAnalyzerProperties();
        performanceAnalyzer = new CprPerformanceAnalyzer(properties);
        trendAnalyzer = new CprTrendAnalyzer(sessionRepository, performanceAnalyzer, properties);
        coachResponseGenerator = new LocalCoachResponseGenerator();
    }

    @AfterEach
    void tearDown() throws IOException {
        Files.deleteIfExists(tempDbPath);
    }

    @Test
    void testResQCoachFeatureFlow() {
        // 1. Saving a CPR session summary
        Instant now = Instant.now();
        saveSession("user-alice", "session-good", now, 92, 53.0, 95.0, 110.0, 95.0, 2.0, 90.0, 2.0);
        saveSession("user-alice", "session-shallow", now.minus(5, ChronoUnit.DAYS), 60, 42.0, 20.0, 108.0, 90.0, 2.0, 85.0, 2.0);
        saveSession("user-alice", "session-fast", now.minus(10, ChronoUnit.DAYS), 62, 52.0, 90.0, 135.0, 10.0, 2.0, 85.0, 2.0);
        saveSession("user-alice", "session-recoil", now.minus(15, ChronoUnit.DAYS), 58, 51.0, 90.0, 105.0, 90.0, 30.0, 80.0, 2.0);
        saveSession("user-alice", "session-fatigue", now.minus(25, ChronoUnit.DAYS), 65, 49.0, 85.0, 106.0, 85.0, 4.0, 78.0, 18.0);

        CprSessionSummaryQueryRequest queryAll = new CprSessionSummaryQueryRequest("user-alice", null, null, null, null);
        List<CprSessionSummaryResponse> allSessions = sessionRepository.findCprSessions(queryAll);
        assertThat(allSessions).hasSize(5);

        // 2. Fetching sessions by user and date range
        String fromStr = now.minus(12, ChronoUnit.DAYS).toString();
        String toStr = now.plus(1, ChronoUnit.DAYS).toString();
        CprSessionSummaryQueryRequest rangeQuery = new CprSessionSummaryQueryRequest("user-alice", null, fromStr, toStr, null);
        List<CprSessionSummaryResponse> rangeSessions = sessionRepository.findCprSessions(rangeQuery);
        assertThat(rangeSessions).hasSize(3); // good, shallow, fast

        // 3. Classifying good performance
        CprSessionSummaryResponse goodSession = allSessions.stream().filter(s -> s.id().equals("session-good")).findFirst().orElseThrow();
        CprPerformanceAnalysis goodAnalysis = performanceAnalyzer.analyze(goodSession);
        assertThat(goodAnalysis.overallStatus()).isEqualTo(CprPerformanceAnalysis.OverallStatus.GOOD);

        // 4. Detecting shallow compression
        CprSessionSummaryResponse shallowSession = allSessions.stream().filter(s -> s.id().equals("session-shallow")).findFirst().orElseThrow();
        CprPerformanceAnalysis shallowAnalysis = performanceAnalyzer.analyze(shallowSession);
        assertThat(shallowAnalysis.overallStatus()).isEqualTo(CprPerformanceAnalysis.OverallStatus.NEEDS_IMPROVEMENT);
        assertThat(shallowAnalysis.warningFlags()).contains("DEPTH_SHALLOW");

        // 5. Detecting fast compression rate
        CprSessionSummaryResponse fastSession = allSessions.stream().filter(s -> s.id().equals("session-fast")).findFirst().orElseThrow();
        CprPerformanceAnalysis fastAnalysis = performanceAnalyzer.analyze(fastSession);
        assertThat(fastAnalysis.warningFlags()).contains("RATE_FAST");

        // 6. Detecting high recoil error
        CprSessionSummaryResponse recoilSession = allSessions.stream().filter(s -> s.id().equals("session-recoil")).findFirst().orElseThrow();
        CprPerformanceAnalysis recoilAnalysis = performanceAnalyzer.analyze(recoilSession);
        assertThat(recoilAnalysis.warningFlags()).contains("HIGH_RECOIL_ERROR");

        // 7. Detecting fatigue
        CprSessionSummaryResponse fatigueSession = allSessions.stream().filter(s -> s.id().equals("session-fatigue")).findFirst().orElseThrow();
        CprPerformanceAnalysis fatigueAnalysis = performanceAnalyzer.analyze(fatigueSession);
        assertThat(fatigueAnalysis.warningFlags()).contains("FATIGUE_DETECTED");

        // 8. Listing bad performances from the last 3 weeks
        Instant threeWeeksAgo = now.minus(21, ChronoUnit.DAYS);
        List<CprBadPerformanceSession> badSessions = performanceAnalyzer.findBadPerformanceSessions(allSessions).stream()
                .filter(s -> s.sessionDateTime().isAfter(threeWeeksAgo))
                .toList();
        assertThat(badSessions).hasSize(3);
        assertThat(badSessions.stream().map(CprBadPerformanceSession::sessionId)).containsExactlyInAnyOrder("session-shallow", "session-fast", "session-recoil");

        // 9. Generating repeated mistake summary
        CprTrendAnalysis trend = trendAnalyzer.analyzeTrend(allSessions);
        saveSession("user-alice", "session-shallow-2", now.minus(1, ChronoUnit.DAYS), 58, 43.0, 18.0, 110.0, 92.0, 2.0, 80.0, 2.0);
        List<CprSessionSummaryResponse> updatedSessions = sessionRepository.findCprSessions(queryAll);
        CprTrendAnalysis updatedTrend = trendAnalyzer.analyzeTrend(updatedSessions);
        assertThat(updatedTrend.repeatedMistakes()).contains("Consistently shallow compressions");

        // 10. Handling empty session history
        CprTrendAnalysis emptyTrend = trendAnalyzer.analyzeTrend(List.of());
        assertThat(emptyTrend.trendDirection()).isEqualTo(CprTrendAnalysis.TrendDirection.NOT_ENOUGH_DATA);
        LocalCoachRequest emptyHistoryRequest = new LocalCoachRequest(
                "Am I improving?", null, List.of(), emptyTrend, null, null
        );
        LocalCoachResponse emptyResponse = coachResponseGenerator.generateResponse(emptyHistoryRequest);
        assertThat(emptyResponse.answer()).contains("not enough training data");

        // 11. Rejecting invalid coach questions
        LocalCoachRequest invalidRequest = new LocalCoachRequest(
                "Can you tell me a story?", null, List.of(), trend, null, null
        );
        LocalCoachResponse invalidResponse = coachResponseGenerator.generateResponse(invalidRequest);
        assertThat(invalidResponse.answer()).contains("review your CPR training history and technique");

        // 12. Blocking unsupported medical/clinical questions
        LocalCoachRequest medicalRequest = new LocalCoachRequest(
                "Diagnose my chest pain", null, List.of(), trend, null, null
        );
        LocalCoachResponse medicalResponse = coachResponseGenerator.generateResponse(medicalRequest);
        assertThat(medicalResponse.answer()).isEqualTo("ResQ Coach can only provide CPR training feedback based on your recorded practice sessions.");
    }

    private void saveSession(
            String traineeId,
            String sessionId,
            Instant time,
            int score,
            double depth,
            double depthAcc,
            double rate,
            double rateAcc,
            double recoilError,
            double consistency,
            double fatigueDrop
    ) {
        SessionSummary summary = new SessionSummary(
                sessionId,
                "M01",
                traineeId,
                time,
                time.plusSeconds(60),
                60L,
                100,
                100,
                (int) (100 * (depthAcc / 100.0)),
                depth,
                1.0,
                rate,
                100.0 - recoilError,
                (int) (100 * ((100.0 - recoilError) / 100.0)),
                (int) (100 * (recoilError / 100.0)),
                0,
                score,
                "FLAGS",
                depth - 5.0,
                depth + 5.0,
                depthAcc,
                rateAcc,
                recoilError,
                0.0,
                consistency,
                fatigueDrop
        );

        SessionEndResponse response = new SessionEndResponse(
                sessionId,
                "M01",
                traineeId,
                time,
                true,
                time.plusSeconds(60),
                "Standard CPR",
                "notes",
                summary,
                "course-101",
                "instructor-1"
        );

        sessionRepository.save(response);
    }
}
