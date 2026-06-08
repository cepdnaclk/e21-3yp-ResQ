package lk.resq.cloudapi.model;

public record CreateCloudUserRequest(
        String displayName,
        String email,
        String role,
        String password
) {
}
