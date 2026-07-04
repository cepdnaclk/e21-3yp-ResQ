package lk.resq.localhub.model.cloudsync;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;

/**
 * A trainee enrollment entry in the cloud roster response.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonInclude(JsonInclude.Include.NON_NULL)
public record CloudRosterEnrollment(
        String courseId,
        String traineeUserId,
        boolean active,
        Instant enrolledAt  // nullable
) {
}
