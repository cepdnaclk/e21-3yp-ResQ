package lk.resq.cloudapi.model;

/**
 * Request DTO carrying a new LocalHub/offline login password.
 */
public record UpdateLocalHubPasswordRequest(
        String password
) {
}
