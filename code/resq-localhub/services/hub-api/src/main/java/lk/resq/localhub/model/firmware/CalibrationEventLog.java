package lk.resq.localhub.model.firmware;

import java.time.Instant;

public record CalibrationEventLog(
        Long id,
        String deviceId,
        String requestId,
        Integer eventId,
        Integer progressId,
        String result,
        String status,
        String reasonId,
        Integer actionId,
        String firmwareState,
        Long tsMs,
        Instant receivedAt,
        String rawPayloadJson
) {
}
