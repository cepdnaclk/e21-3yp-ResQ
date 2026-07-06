package lk.resq.localhub.service;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import org.junit.jupiter.api.Test;

import lk.resq.localhub.config.CprPerformanceAnalyzerProperties;
import lk.resq.localhub.model.cpr.CprBadPerformanceSession;
import lk.resq.localhub.model.cpr.CprPerformanceAnalysis.OverallStatus;
import lk.resq.localhub.model.cpr.CprSessionSummaryResponse;

class CprPerformanceAnalyzerTest {

    @Test
    void classifiesGoodSessionWithTargetRangeMetrics() {
        CprPerformanceAnalyzer analyzer = newAnalyzer(defaultProperties());
        CprSessionSummaryResponse session = session(52.0, 110.0, 5.0, 82.0, 4.0, 1, 1.0);

        var analysis = analyzer.analyze(session);

        assertThat(analysis.overallStatus()).isEqualTo(OverallStatus.GOOD);
        assertThat(analysis.mainIssues()).isEmpty();
        assertThat(analysis.warningFlags()).isEmpty();
        assertThat(analysis.strengths()).isNotEmpty();
        assertThat(analysis.shortSummary()).containsIgnoringCase("good CPR practice");
    }

    @Test
    void classifiesPoorSessionWithMultipleWarningFlags() {
        CprPerformanceAnalyzer analyzer = newAnalyzer(customProperties());
        CprSessionSummaryResponse session = session(44.0, 128.0, 22.0, 61.0, 18.0, 5, 4.5);

        var analysis = analyzer.analyze(session);

        assertThat(analysis.overallStatus()).isEqualTo(OverallStatus.POOR);
        assertThat(analysis.warningFlags())
                .containsExactlyInAnyOrder("DEPTH_SHALLOW", "RATE_FAST", "HIGH_RECOIL_ERROR", "POOR_CONSISTENCY", "FATIGUE_DETECTED", "EXCESSIVE_PAUSES");
        assertThat(analysis.mainIssues()).hasSize(6);
        assertThat(analysis.recommendations()).hasSize(6);
        assertThat(analysis.shortSummary()).containsIgnoringCase("needs more practice");
    }

    @Test
    void findsBadSessionForShallowDepth() {
        CprPerformanceAnalyzer analyzer = newAnalyzer(defaultProperties());

        List<CprBadPerformanceSession> sessions = analyzer.findBadPerformanceSessions(
                List.of(session(44.0, 110.0, 8.0, 82.0, 0.0, 1, 1.0))
        );

        assertThat(sessions).hasSize(1);
        assertThat(sessions.get(0).failedMetrics()).contains("avgDepthMm");
        assertThat(sessions.get(0).shortReason()).containsIgnoringCase("shallow");
    }

    @Test
    void findsBadSessionForFastRate() {
        CprPerformanceAnalyzer analyzer = newAnalyzer(defaultProperties());

        List<CprBadPerformanceSession> sessions = analyzer.findBadPerformanceSessions(
                List.of(session(52.0, 132.0, 8.0, 82.0, 0.0, 1, 1.0))
        );

        assertThat(sessions).hasSize(1);
        assertThat(sessions.get(0).failedMetrics()).contains("avgRateCpm");
        assertThat(sessions.get(0).shortReason()).containsIgnoringCase("rate");
    }

    @Test
    void findsBadSessionForHighRecoilError() {
        CprPerformanceAnalyzer analyzer = newAnalyzer(defaultProperties());

        List<CprBadPerformanceSession> sessions = analyzer.findBadPerformanceSessions(
                List.of(session(52.0, 110.0, 20.0, 82.0, 0.0, 1, 1.0))
        );

        assertThat(sessions).hasSize(1);
        assertThat(sessions.get(0).failedMetrics()).contains("recoilErrorPercent");
        assertThat(sessions.get(0).shortReason()).containsIgnoringCase("recoil");
    }

    @Test
    void findsBadSessionForFatigueDetected() {
        CprPerformanceAnalyzer analyzer = newAnalyzer(defaultProperties());

        List<CprBadPerformanceSession> sessions = analyzer.findBadPerformanceSessions(
                List.of(session(52.0, 110.0, 8.0, 82.0, 18.0, 1, 1.0))
        );

        assertThat(sessions).hasSize(1);
        assertThat(sessions.get(0).failedMetrics()).contains("fatigueDropPercent");
        assertThat(sessions.get(0).shortReason()).containsIgnoringCase("fatigue");
    }

    @Test
    void doesNotReturnGoodSessionAsBad() {
        CprPerformanceAnalyzer analyzer = newAnalyzer(defaultProperties());

        List<CprBadPerformanceSession> sessions = analyzer.findBadPerformanceSessions(
                List.of(session(52.0, 110.0, 5.0, 82.0, 1.0, 1, 1.0))
        );

        assertThat(sessions).isEmpty();
    }

    private static CprPerformanceAnalyzer newAnalyzer(CprPerformanceAnalyzerProperties properties) {
        return new CprPerformanceAnalyzer(properties);
    }

    private static CprPerformanceAnalyzerProperties defaultProperties() {
        return new CprPerformanceAnalyzerProperties();
    }

    private static CprPerformanceAnalyzerProperties customProperties() {
        CprPerformanceAnalyzerProperties properties = new CprPerformanceAnalyzerProperties();
        properties.setRecoilErrorThresholdPercent(15.0);
        properties.setConsistencyScoreThreshold(70.0);
        properties.setFatigueDropThresholdPercent(10.0);
        properties.setExcessivePauseCountThreshold(2);
        properties.setExcessiveLongestPauseSecondsThreshold(2.5);
        return properties;
    }

    private static CprSessionSummaryResponse session(
            double avgDepthMm,
            double avgRateCpm,
            double recoilErrorPercent,
            double consistencyScore,
            double fatigueDropPercent,
            int pauseCount,
            double longestPauseSeconds
    ) {
        Instant startedAt = Instant.parse("2026-06-08T08:00:00Z");
        Instant endedAt = Instant.parse("2026-06-08T08:01:00Z");
        return new CprSessionSummaryResponse(
                "session-1",
                "user-1",
                "trainee-1",
                "manikin-1",
                startedAt,
                endedAt,
                60,
                avgDepthMm,
                48.0,
                56.0,
                80.0,
                avgRateCpm,
                90.0,
                recoilErrorPercent,
                pauseCount,
                longestPauseSeconds,
                consistencyScore,
                fatigueDropPercent,
                91,
                startedAt.plusSeconds(65)
        );
    }
}
