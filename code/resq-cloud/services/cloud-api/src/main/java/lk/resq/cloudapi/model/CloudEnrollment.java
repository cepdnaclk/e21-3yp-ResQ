package lk.resq.cloudapi.model;

import java.time.Instant;

public record CloudEnrollment(
        String enrollmentId,
        String courseId,
        String traineeId,
        String traineeDisplayName,
        String traineeEmail,
        boolean active,
        Instant enrolledAt
) {
}
