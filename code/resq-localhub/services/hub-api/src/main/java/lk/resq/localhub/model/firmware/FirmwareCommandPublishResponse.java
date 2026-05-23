package lk.resq.localhub.model.firmware;

public record FirmwareCommandPublishResponse(
        String deviceId,
        String requestId,
        String topic,
        String status,
        String message
) {
}