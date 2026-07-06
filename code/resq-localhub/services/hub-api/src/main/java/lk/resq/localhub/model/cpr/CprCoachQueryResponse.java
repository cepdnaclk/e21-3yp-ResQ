package lk.resq.localhub.model.cpr;

import java.util.List;

public record CprCoachQueryResponse(
        String answer,
        List<String> mainIssues,
        List<String> recommendations,
        List<CprBadPerformanceSession> badSessions,
        String trendDirection
) {}
