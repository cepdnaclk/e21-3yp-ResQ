package lk.resq.localhub.service;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import org.junit.jupiter.api.Test;

import lk.resq.localhub.config.CprPerformanceAnalyzerProperties;
import lk.resq.localhub.model.cpr.CprSessionSummaryResponse;
import lk.resq.localhub.model.cpr.CprTrendAnalysis;
import lk.resq.localhub.model.cpr.CprTrendAnalysis.TrendDirection;

class CprTrendAnalyzerTest {

    @Test
    void returnsNotEnoughDataWhenFewerThanTwoSessions() {
        CprTrendAnalyzer analyzer = newAnalyzer();

        CprTrendAnalysis emptyAnalysis = analyzer.analyzeTrend(List.of());
        assertThat(emptyAnalysis.trendDirection()).isEqualTo(TrendDirection.NOT_ENOUGH_DATA);
        assertThat(emptyAnalysis.totalSessions()).isZero();

        CprTrendAnalysis singleAnalysis = analyzer.analyzeTrend(List.of(session(1, 80.0, 90.0, 90.0, 2.0, 10.0, 80.0)));
        assertThat(singleAnalysis.trendDirection()).isEqualTo(TrendDirection.NOT_ENOUGH_DATA);
        assertThat(singleAnalysis.totalSessions()).isEqualTo(1);
    }

    @Test
    void detectsImprovingTrendWithCorrectAreas() {
        CprTrendAnalyzer analyzer = newAnalyzer();

        // 4 sessions chronologically showing improvement
        List<CprSessionSummaryResponse> sessions = List.of(
                session(1, 60.0, 65.0, 70.0, 15.0, 15.0, 70.0), // earliest
                session(2, 65.0, 70.0, 72.0, 12.0, 12.0, 75.0),
                session(3, 85.0, 88.0, 85.0, 2.0, 5.0, 85.0),
                session(4, 90.0, 92.0, 90.0, 1.0, 2.0, 92.0)   // recent
        );

        CprTrendAnalysis trend = analyzer.analyzeTrend(sessions);
        assertThat(trend.trendDirection()).isEqualTo(TrendDirection.IMPROVING);
        assertThat(trend.totalSessions()).isEqualTo(4);
        assertThat(trend.bestSession().id()).isEqualTo("session-4");
        assertThat(trend.worstSession().id()).isEqualTo("session-1");
        
        // Depth accuracy increased from (65+70)/2 = 67.5 to (88+92)/2 = 90.0 (> 2.0 increase)
        assertThat(trend.improvedAreas()).contains("Compression depth accuracy");
        // Recoil performance increased, fatigue decreased, etc.
        assertThat(trend.improvedAreas()).contains("Stamina (reduced fatigue signs)");
    }

    @Test
    void detectsDecliningTrendWithCorrectAreas() {
        CprTrendAnalyzer analyzer = newAnalyzer();

        // 4 sessions chronologically showing decline
        List<CprSessionSummaryResponse> sessions = List.of(
                session(1, 92.0, 92.0, 90.0, 1.0, 2.0, 92.0),   // earliest
                session(2, 85.0, 88.0, 85.0, 2.0, 5.0, 85.0),
                session(3, 65.0, 70.0, 72.0, 12.0, 12.0, 75.0),
                session(4, 60.0, 60.0, 68.0, 20.0, 20.0, 65.0)   // recent (overallScore 60.0)
        );

        CprTrendAnalysis trend = analyzer.analyzeTrend(sessions);
        assertThat(trend.trendDirection()).isEqualTo(TrendDirection.DECLINING);
        assertThat(trend.totalSessions()).isEqualTo(4);
        assertThat(trend.bestSession().id()).isEqualTo("session-1");
        assertThat(trend.worstSession().id()).isEqualTo("session-4");

        // Depth accuracy declined from (92+88)/2 = 90.0 to (70+60)/2 = 65.0 (< -2.0 decrease)
        assertThat(trend.weakestAreas()).contains("Compression depth accuracy");
    }

    @Test
    void identifiesRepeatedIssues() {
        CprTrendAnalyzer analyzer = newAnalyzer();

        // 3 sessions where DEPTH_SHALLOW is repeated (avgDepthMm < 50)
        List<CprSessionSummaryResponse> sessions = List.of(
                session(1, 70.0, 80.0, 85.0, 2.0, 5.0, 80.0, 42.0, 110.0), // DEPTH_SHALLOW
                session(2, 80.0, 85.0, 85.0, 3.0, 4.0, 82.0, 44.0, 110.0), // DEPTH_SHALLOW
                session(3, 85.0, 90.0, 90.0, 2.0, 2.0, 88.0, 52.0, 110.0)  // DEPTH_OK
        );

        CprTrendAnalysis trend = analyzer.analyzeTrend(sessions);
        assertThat(trend.repeatedMistakes()).contains("Consistently shallow compressions");
    }

    private static CprTrendAnalyzer newAnalyzer() {
        CprPerformanceAnalyzerProperties properties = new CprPerformanceAnalyzerProperties();
        CprPerformanceAnalyzer perfAnalyzer = new CprPerformanceAnalyzer(properties);
        return new CprTrendAnalyzer(perfAnalyzer, properties);
    }

    private static CprSessionSummaryResponse session(
            int index,
            double overallScore,
            double depthAccuracy,
            double rateAccuracy,
            double recoilError,
            double fatigueDrop,
            double consistency
    ) {
        return session(index, overallScore, depthAccuracy, rateAccuracy, recoilError, fatigueDrop, consistency, 52.0, 110.0);
    }

    private static CprSessionSummaryResponse session(
            int index,
            double overallScore,
            double depthAccuracy,
            double rateAccuracy,
            double recoilError,
            double fatigueDrop,
            double consistency,
            double avgDepth,
            double avgRate
    ) {
        Instant startedAt = Instant.parse("2026-06-08T08:00:00Z").plusSeconds(index * 3600);
        Instant endedAt = startedAt.plusSeconds(60);
        return new CprSessionSummaryResponse(
                "session-" + index,
                "user-1",
                "trainee-1",
                "manikin-1",
                startedAt,
                endedAt,
                60,
                avgDepth,
                48.0,
                56.0,
                depthAccuracy,
                avgRate,
                rateAccuracy,
                recoilError,
                1,
                1.0,
                consistency,
                fatigueDrop,
                (int) overallScore,
                startedAt.plusSeconds(65)
        );
    }
}
