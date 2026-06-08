package lk.resq.cloudapi.model;

import java.time.Instant;

public record CloudCourse(
        String courseId,
        String courseCode,
        String title,
        String description,
        String instructorId,
        String instructorDisplayName,
        boolean active,
        Instant createdAt,
        Instant updatedAt
) {
}
