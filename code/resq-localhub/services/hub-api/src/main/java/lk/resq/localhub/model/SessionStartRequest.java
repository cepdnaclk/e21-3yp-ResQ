package lk.resq.localhub.model;

public record SessionStartRequest(
        String deviceId,
        String traineeId,
        String scenario,
        String notes
) {
}
