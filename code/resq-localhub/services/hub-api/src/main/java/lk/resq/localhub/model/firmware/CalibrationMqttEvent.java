package lk.resq.localhub.model.firmware;

import java.time.Instant;

public record CalibrationMqttEvent(
        String deviceId,
        Integer eventId,
        String replyId,
        String status,
        Integer progressId,
        String result,
        String reasonId,
        Integer actionId,
        String firmwareState,
        Long tsMs,
        Instant receivedAt
) {
}
