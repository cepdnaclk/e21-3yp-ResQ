package lk.resq.cloudapi.model;

import java.time.Instant;

/**
 * Represents a registered LocalHub entry. key_hash is BCrypt-hashed;
 * plaintext key is never stored or returned.
 */
public record CloudHubApiKey(
        String hubId,
        String hubName,
        String keyHash,
        boolean active,
        Instant createdAt,
        Instant updatedAt,
        Instant lastUsedAt   // nullable
) {
}
