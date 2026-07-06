package lk.resq.localhub.model.cpr;

import java.util.List;

public record CprTrendAnalysis(
        int totalSessions,
        double averageOverallScore,
        CprSessionSummaryResponse bestSession,
        CprSessionSummaryResponse worstSession,
        TrendDirection trendDirection,
        List<String> repeatedMistakes,
        List<String> improvedAreas,
        List<String> weakestAreas,
        String recommendationSummary
) {
    public enum TrendDirection {
        IMPROVING,
        DECLINING,
        STABLE,
        NOT_ENOUGH_DATA
    }
}
