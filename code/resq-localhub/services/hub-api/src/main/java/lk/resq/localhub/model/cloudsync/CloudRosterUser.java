package lk.resq.localhub.model.cloudsync;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;

/**
 * A user entry in the cloud roster response.
 * {@code password_hash} is never present — the cloud side intentionally omits it.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonInclude(JsonInclude.Include.NON_NULL)
public record CloudRosterUser(
        String cloudUserId,
        String displayName,
        String email,       // nullable
        String role,        // ADMIN | INSTRUCTOR | TRAINEE
        boolean active,
        Instant updatedAt,
        String localLoginHash // nullable (Phase 3B)
) {
    public CloudRosterUser(
            String cloudUserId,
            String displayName,
            String email,
            String role,
            boolean active,
            Instant updatedAt
    ) {
        this(cloudUserId, displayName, email, role, active, updatedAt, null);
    }
}