package lk.resq.localhub.model.cpr;

import java.util.List;

public record CprInstructorCoachResponse(
        String answer,
        List<PriorityTrainee> priorityTrainees,
        List<String> commonIssues,
        List<String> suggestedInstructorActions,
        List<String> relatedSessionIds
) {
    public record PriorityTrainee(
            String traineeId,
            String name,
            int lastSessionScore,
            String reasonForAttention,
            String lastSessionId
    ) {}
}
