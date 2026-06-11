package lk.resq.cloudapi.model;

import java.time.Instant;

public record CloudUserCredentials(
        CloudUser user,
        String passwordHash,
        Instant lastLoginAt,
        Instant passwordUpdatedAt
) {
}
