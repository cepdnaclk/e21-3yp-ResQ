package lk.resq.localhub.model.cpr;

import java.time.Instant;

public record CprInstructorCoachQueryRequest(
        String question,
        String traineeId,
        String sessionId,
        Instant fromDate,
        Instant toDate
) {}
