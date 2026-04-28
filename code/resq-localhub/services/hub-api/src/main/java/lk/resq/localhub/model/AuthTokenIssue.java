package lk.resq.localhub.model;

import java.time.Instant;

public record AuthTokenIssue(
        AuthUser user,
        String token,
        Instant expiresAt
) {
}
