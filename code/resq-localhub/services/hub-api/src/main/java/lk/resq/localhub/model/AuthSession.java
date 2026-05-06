package lk.resq.localhub.model;

import java.time.Instant;

public record AuthSession(
        String id,
        String userId,
        String tokenHash,
        Instant createdAt,
        Instant expiresAt,
        Instant revokedAt
) {
}
