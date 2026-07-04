package lk.resq.localhub.model.cloudsync;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * Instructor-to-course assignment entry in the cloud roster response.
 * Derived on the cloud side from {@code cloud_courses.instructor_id}.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonInclude(JsonInclude.Include.NON_NULL)
public record CloudRosterInstructorAssignment(
        String courseId,
        String instructorUserId,
        boolean active
) {
}
