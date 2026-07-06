package lk.resq.localhub.model.cpr;

import java.util.List;

public record CprPerformanceAnalysis(
        OverallStatus overallStatus,
        List<String> mainIssues,
        List<String> strengths,
        List<String> recommendations,
        List<String> warningFlags,
        String shortSummary
) {
    public enum OverallStatus {
        GOOD,
        NEEDS_IMPROVEMENT,
        POOR
    }
}