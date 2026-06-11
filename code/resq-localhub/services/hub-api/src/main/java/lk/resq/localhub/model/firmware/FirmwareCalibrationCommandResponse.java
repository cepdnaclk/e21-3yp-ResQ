package lk.resq.localhub.model.firmware;

public record FirmwareCalibrationCommandResponse(
        String deviceId,
        String requestId,
        String topic,
        String status,
        String message
) {
}
