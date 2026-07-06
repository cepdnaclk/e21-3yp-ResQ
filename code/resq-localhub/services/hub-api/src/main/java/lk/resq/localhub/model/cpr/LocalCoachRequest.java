package lk.resq.localhub.model.cpr;

import java.util.List;

public record LocalCoachRequest(
        String question,
        CprPerformanceAnalysis lastSessionAnalysis,
        List<CprBadPerformanceSession> badSessions,
        CprTrendAnalysis trendAnalysis,
        CprSessionSummaryResponse lastSession,
        CprSessionSummaryResponse bestSession
) {}
