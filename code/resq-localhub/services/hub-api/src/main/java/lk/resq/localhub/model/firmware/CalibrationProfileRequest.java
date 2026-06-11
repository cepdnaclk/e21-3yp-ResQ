package lk.resq.localhub.model.firmware;

public record CalibrationProfileRequest(
        String name,
        Integer hallDelta,
        Integer refPressure,
        Integer bladder1Pressure,
        Integer bladder2Pressure,
        String description,
        Boolean active,
        Boolean defaultProfile
) {
}