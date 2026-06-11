package lk.resq.localhub.model.firmware;

import java.time.Instant;

public record FirmwareCalibrationResultRecord(
        long id,
        String deviceId,
        String profileId,
        String requestId,
        String replyId,
        Integer eventId,
        String result,
        String status,
        Integer progressId,
        String reasonId,
        Integer actionId,
        String firmwareState,
        Boolean calibrated,
        Long tsMs,
        Instant receivedAt,
        String payloadJson
) {
}