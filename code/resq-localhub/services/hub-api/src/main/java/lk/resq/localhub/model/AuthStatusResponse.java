package lk.resq.localhub.model;

public record AuthStatusResponse(
        boolean hasUsers,
        boolean requiresFirstAdmin
) {
}
