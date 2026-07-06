package lk.resq.localhub.model.cpr;

import java.time.Instant;
import java.util.List;

public record CprBadPerformanceSession(
        String sessionId,
        Instant sessionDateTime,
        int overallScore,
        List<String> failedMetrics,
        String shortReason,
        String recommendation
) {
}