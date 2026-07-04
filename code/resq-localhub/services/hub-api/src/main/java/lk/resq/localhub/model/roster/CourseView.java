package lk.resq.localhub.model.roster;

public record CourseView(
        String cloudCourseId,
        String courseCode,
        String title,
        String description,
        String instructorCloudUserId,
        boolean active
) {}
