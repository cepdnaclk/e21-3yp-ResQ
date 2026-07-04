package lk.resq.cloudapi.model;

import java.time.Instant;

/**
 * A trainee enrollment entry inside the roster snapshot.
 */
public record CloudRosterEnrollment(
        String courseId,
        String traineeUserId,
        boolean active,
        Instant enrolledAt   // nullable if the field is unavailable
) {
}
