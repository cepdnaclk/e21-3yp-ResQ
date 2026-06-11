package lk.resq.cloudapi.model;

/**
 * Instructor-to-course assignment entry inside the roster snapshot.
 * Derived from cloud_courses.instructor_id where instructor_id IS NOT NULL AND active = TRUE.
 */
public record CloudRosterInstructorAssignment(
        String courseId,
        String instructorUserId,
        boolean active
) {
}
