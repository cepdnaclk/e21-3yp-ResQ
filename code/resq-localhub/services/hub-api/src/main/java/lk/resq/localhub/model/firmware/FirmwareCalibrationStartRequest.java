package lk.resq.localhub.model.firmware;

public record FirmwareCalibrationStartRequest(
        Integer hallDelta,
        Integer refPressure,
        Integer bladder1Pressure,
        Integer bladder2Pressure,
        String profileId
) {
}
