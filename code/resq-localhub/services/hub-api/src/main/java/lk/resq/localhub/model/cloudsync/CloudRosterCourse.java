package lk.resq.localhub.model.cloudsync;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;

/**
 * A course entry in the cloud roster response.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonInclude(JsonInclude.Include.NON_NULL)
public record CloudRosterCourse(
        String cloudCourseId,
        String courseCode,    // nullable
        String title,
        String description,   // nullable
        String instructorId,  // nullable - cloud user UUID of assigned instructor
        boolean active,
        Instant updatedAt
) {
}
