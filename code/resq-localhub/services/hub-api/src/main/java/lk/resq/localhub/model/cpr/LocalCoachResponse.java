package lk.resq.localhub.model.cpr;

import java.util.List;

public record LocalCoachResponse(
        String answer,
        List<String> mainIssues,
        List<String> recommendations,
        List<String> relatedSessions
) {}
