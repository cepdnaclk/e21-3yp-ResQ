package lk.resq.localhub.model.firmware;

public record CalibrationProfileResponse(
        String profileId,
        String name,
        Integer hallDelta,
        Integer refPressure,
        Integer bladder1Pressure,
        Integer bladder2Pressure,
        String description,
        boolean active,
        boolean defaultProfile,
        String createdAt,
        String updatedAt,
        int version,
        String profileHash
) {
}