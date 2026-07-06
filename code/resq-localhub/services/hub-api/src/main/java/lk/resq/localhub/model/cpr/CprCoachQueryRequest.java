package lk.resq.localhub.model.cpr;

import java.time.Instant;

public record CprCoachQueryRequest(
        String userId,
        String question,
        Instant fromDate,
        Instant toDate
) {}
