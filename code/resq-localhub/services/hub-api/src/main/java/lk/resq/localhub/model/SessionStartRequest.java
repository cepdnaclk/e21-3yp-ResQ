package lk.resq.localhub.model;

public record SessionStartRequest(
        String deviceId,
        String traineeId,
        String courseId,
        String traineeRecordId,
        QuickTrainee quickTrainee,
        String guestLabel,
        String profileId,
        String scenario,
        String notes
) {
    public SessionStartRequest(
            String deviceId,
            String traineeId,
            String courseId,
            String traineeRecordId,
            QuickTrainee quickTrainee,
            String guestLabel,
            String scenario,
            String notes
    ) {
        this(deviceId, traineeId, courseId, traineeRecordId, quickTrainee, guestLabel, null, scenario, notes);
    }

    public SessionStartRequest(
            String deviceId,
            String traineeId,
            String traineeRecordId,
            QuickTrainee quickTrainee,
            String guestLabel,
            String scenario,
            String notes
    ) {
        this(deviceId, traineeId, null, traineeRecordId, quickTrainee, guestLabel, null, scenario, notes);
    }

    public record QuickTrainee(
            String traineeCode,
            String displayName,
            String groupName
    ) {
    }
}
