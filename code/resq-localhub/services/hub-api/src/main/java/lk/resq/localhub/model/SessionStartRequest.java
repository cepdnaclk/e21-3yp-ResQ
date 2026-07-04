package lk.resq.localhub.model;

public record SessionStartRequest(
        String deviceId,
        String traineeId,
        String courseId,
        String traineeRecordId,
        QuickTrainee quickTrainee,
        String guestLabel,
        String scenario,
        String notes
) {
    public SessionStartRequest(
            String deviceId,
            String traineeId,
            String traineeRecordId,
            QuickTrainee quickTrainee,
            String guestLabel,
            String scenario,
            String notes
    ) {
        this(deviceId, traineeId, null, traineeRecordId, quickTrainee, guestLabel, scenario, notes);
    }

    public record QuickTrainee(
            String traineeCode,
            String displayName,
            String groupName
    ) {
    }
}
