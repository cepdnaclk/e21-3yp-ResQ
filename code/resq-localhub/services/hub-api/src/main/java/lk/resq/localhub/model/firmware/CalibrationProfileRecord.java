package lk.resq.localhub.model.firmware;

public record CalibrationProfileRecord(
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
        int version
) {
    public CalibrationProfileRecord(
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
            String updatedAt
    ) {
        this(profileId, name, hallDelta, refPressure, bladder1Pressure, bladder2Pressure, description, active, defaultProfile, createdAt, updatedAt, 1);
    }
}