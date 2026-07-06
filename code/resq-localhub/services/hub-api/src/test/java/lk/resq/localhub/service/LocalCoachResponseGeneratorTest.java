package lk.resq.localhub.service;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import org.junit.jupiter.api.Test;

import lk.resq.localhub.model.cpr.CprBadPerformanceSession;
import lk.resq.localhub.model.cpr.CprPerformanceAnalysis;
import lk.resq.localhub.model.cpr.CprSessionSummaryResponse;
import lk.resq.localhub.model.cpr.CprTrendAnalysis;
import lk.resq.localhub.model.cpr.LocalCoachRequest;
import lk.resq.localhub.model.cpr.LocalCoachResponse;

class LocalCoachResponseGeneratorTest {

    private final LocalCoachResponseGenerator generator = new LocalCoachResponseGenerator();

    @Test
    void testQuestionListBadPerformances() {
        CprBadPerformanceSession badSession = new CprBadPerformanceSession(
                "session-1",
                Instant.parse("2026-06-08T08:00:00Z"),
                65,
                List.of("avgDepthMm"),
                "Shallow depth",
                "Practice deeper compressions."
        );

        LocalCoachRequest request = new LocalCoachRequest(
                "List my bad performances in the last 3 weeks",
                null,
                List.of(badSession),
                null,
                null,
                null
        );

        LocalCoachResponse response = generator.generateResponse(request);

        assertThat(response.answer()).contains("1 session(s) marked with sub-optimal performance");
        assertThat(response.mainIssues()).contains("avgDepthMm");
        assertThat(response.recommendations()).contains("Practice deeper compressions.");
        assertThat(response.relatedSessions()).contains("session-1 (2026-06-08T08:00:00Z)");
    }

    @Test
    void testQuestionWhatMistakesDoIRepeat() {
        CprTrendAnalysis trend = new CprTrendAnalysis(
                5,
                82.0,
                null,
                null,
                CprTrendAnalysis.TrendDirection.STABLE,
                List.of("Consistently shallow compressions"),
                List.of(),
                List.of("Compression depth accuracy"),
                "Stable performance."
        );

        LocalCoachRequest request = new LocalCoachRequest(
                "What mistakes do I repeat most?",
                null,
                null,
                trend,
                null,
                null
        );

        LocalCoachResponse response = generator.generateResponse(request);

        assertThat(response.answer()).contains("frequently experience: Consistently shallow compressions");
        assertThat(response.mainIssues()).contains("Consistently shallow compressions");
        assertThat(response.recommendations()).contains("Practice compressing deeper until you hit the target 50-60mm range.");
    }

    @Test
    void testQuestionAmIImproving() {
        CprTrendAnalysis trend = new CprTrendAnalysis(
                5,
                88.0,
                null,
                null,
                CprTrendAnalysis.TrendDirection.IMPROVING,
                List.of(),
                List.of("Compression depth accuracy"),
                List.of(),
                "Improving performance."
        );

        LocalCoachRequest request = new LocalCoachRequest(
                "Am I improving?",
                null,
                null,
                trend,
                null,
                null
        );

        LocalCoachResponse response = generator.generateResponse(request);

        assertThat(response.answer()).contains("Yes! Your overall CPR score shows a positive trend");
        assertThat(response.answer()).contains("Compression depth accuracy");
    }

    @Test
    void testQuestionWhatShouldIPracticeNext() {
        CprPerformanceAnalysis analysis = new CprPerformanceAnalysis(
                CprPerformanceAnalysis.OverallStatus.NEEDS_IMPROVEMENT,
                List.of("Slow compression rate"),
                List.of(),
                List.of("Speed up compressions slightly."),
                List.of("RATE_SLOW"),
                "Rate slow summary."
        );

        LocalCoachRequest request = new LocalCoachRequest(
                "What should I practice next?",
                analysis,
                null,
                null,
                null,
                null
        );

        LocalCoachResponse response = generator.generateResponse(request);

        assertThat(response.answer()).contains("focus on: Slow compression rate");
        assertThat(response.mainIssues()).contains("Slow compression rate");
        assertThat(response.recommendations()).contains("Speed up compressions slightly.");
    }

    @Test
    void testQuestionCompareLastAndBest() {
        CprSessionSummaryResponse last = session("session-last", 78);
        CprSessionSummaryResponse best = session("session-best", 90);

        LocalCoachRequest request = new LocalCoachRequest(
                "Compare my last session with my best session",
                null,
                null,
                null,
                last,
                best
        );

        LocalCoachResponse response = generator.generateResponse(request);

        assertThat(response.answer()).contains("12% points lower than your best session");
        assertThat(response.relatedSessions()).contains("Last Session: session-last", "Best Session: session-best");
    }

    @Test
    void testUnsupportedAnimalQuery() {
        LocalCoachRequest request = new LocalCoachRequest(
                "Can I do CPR on a cat?",
                null,
                null,
                null,
                null,
                null
        );

        LocalCoachResponse response = generator.generateResponse(request);
        assertThat(response.answer()).isEqualTo("ResQ Coach can only provide CPR training feedback based on your recorded practice sessions.");
    }

    @Test
    void testMedicalDiagnosisFallback() {
        LocalCoachRequest request = new LocalCoachRequest(
                "Can you diagnose my chest pain?",
                null,
                null,
                null,
                null,
                null
        );

        LocalCoachResponse response = generator.generateResponse(request);
        assertThat(response.answer()).isEqualTo("ResQ Coach can only provide CPR training feedback based on your recorded practice sessions.");
    }

    @Test
    void testEmergencyActionFallback() {
        LocalCoachRequest request = new LocalCoachRequest(
                "Someone is having a stroke, what emergency steps should I take?",
                null,
                null,
                null,
                null,
                null
        );

        LocalCoachResponse response = generator.generateResponse(request);
        assertThat(response.answer()).isEqualTo("ResQ Coach can only provide CPR training feedback based on your recorded practice sessions.");
    }

    @Test
    void testUnrecognizedFallback() {
        LocalCoachRequest request = new LocalCoachRequest(
                "Can you tell me a joke about CPR?",
                null,
                null,
                null,
                null,
                null
        );

        LocalCoachResponse response = generator.generateResponse(request);
        assertThat(response.answer()).contains("review your CPR training history and technique");
    }

    private static CprSessionSummaryResponse session(String id, int score) {
        return new CprSessionSummaryResponse(
                id,
                "user-1",
                "trainee-1",
                "manikin-1",
                Instant.now(),
                Instant.now().plusSeconds(60),
                60,
                52.0,
                48.0,
                56.0,
                85.0,
                110.0,
                90.0,
                5.0,
                1,
                1.0,
                82.0,
                2.0,
                score,
                Instant.now()
        );
    }
}
