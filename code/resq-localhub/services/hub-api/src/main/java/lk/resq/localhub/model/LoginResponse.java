package lk.resq.localhub.model;

import java.time.Instant;

public record LoginResponse(
        AuthUser user,
        Instant expiresAt
) {
}
