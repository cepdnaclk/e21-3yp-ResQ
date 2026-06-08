package lk.resq.cloudapi.model;

public record CloudLoginRequest(
        String email,
        String password
) {
}
