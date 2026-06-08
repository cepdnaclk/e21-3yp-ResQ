package lk.resq.cloudapi.model;

import java.time.Instant;

public record CloudLoginResponse(
        String accessToken,
        String tokenType,
        Instant expiresAt,
        CloudUser user
) {
}
