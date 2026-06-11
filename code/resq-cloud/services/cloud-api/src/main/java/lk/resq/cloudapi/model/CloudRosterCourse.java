package lk.resq.cloudapi.model;

import java.time.Instant;

/**
 * A course entry inside the roster snapshot.
 */
public record CloudRosterCourse(
        String cloudCourseId,
        String courseCode,    // nullable
        String title,
        String description,   // nullable
        String instructorId,  // nullable - cloud user UUID of the assigned instructor
        boolean active,
        Instant updatedAt
) {
}
