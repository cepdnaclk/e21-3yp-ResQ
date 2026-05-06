package lk.resq.localhub.model;

public record SessionStartRequest(
        String deviceId,
        String traineeId,
        String traineeRecordId,
        QuickTrainee quickTrainee,
        String guestLabel,
        String scenario,
        String notes
) {
    public record QuickTrainee(
            String traineeCode,
            String displayName,
            String groupName
    ) {
    }
}
