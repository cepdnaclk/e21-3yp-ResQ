package lk.resq.cloudapi.model;

import java.time.Instant;

public record CloudUser(
        String userId,
        String displayName,
        String email,
        CloudUserRole role,
        boolean active,
        Instant createdAt,
        Instant updatedAt
) {
}
