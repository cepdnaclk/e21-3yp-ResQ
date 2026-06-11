package lk.resq.cloudapi.model;

import java.time.Instant;

/**
 * A user entry inside the roster snapshot.
 * password_hash is intentionally excluded.
 */
public record CloudRosterUser(
        String cloudUserId,
        String displayName,
        String email,        // nullable
        String role,         // ADMIN | INSTRUCTOR | TRAINEE
        boolean active,
        Instant updatedAt
) {
}
