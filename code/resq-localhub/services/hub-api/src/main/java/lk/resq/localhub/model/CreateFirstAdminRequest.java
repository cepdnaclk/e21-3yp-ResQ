package lk.resq.localhub.model;

public record CreateFirstAdminRequest(
        String username,
        String displayName,
        String password
) {
}
