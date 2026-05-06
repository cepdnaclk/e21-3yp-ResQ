package lk.resq.localhub.model;

public record AuthUser(
        String id,
        String username,
        String displayName,
        UserRole role,
        String disabledAt
) {
}
