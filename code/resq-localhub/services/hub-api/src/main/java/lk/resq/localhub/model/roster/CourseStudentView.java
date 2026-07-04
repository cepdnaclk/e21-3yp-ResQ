package lk.resq.localhub.model.roster;

public record CourseStudentView(
        String cloudUserId,
        String displayName,
        String email,
        String enrolledAt
) {}
