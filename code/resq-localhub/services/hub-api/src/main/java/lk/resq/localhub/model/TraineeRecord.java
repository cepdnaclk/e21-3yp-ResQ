package lk.resq.localhub.model;

public record TraineeRecord(
        String id,
        String traineeCode,
        String displayName,
        String groupName,
        String notes,
        String createdAt,
        String updatedAt,
        String archivedAt
) {
}
