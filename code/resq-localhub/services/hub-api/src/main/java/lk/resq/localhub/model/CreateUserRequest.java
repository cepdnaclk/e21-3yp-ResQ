package lk.resq.localhub.model;

public record CreateUserRequest(
        String username,
        String displayName,
        String password,
        UserRole role
) {
}
