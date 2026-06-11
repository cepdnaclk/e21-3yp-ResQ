package lk.resq.localhub.model.firmware;

import java.time.Instant;

public record FirmwareEventRecord(
        long id,
        String deviceId,
        String topic,
        String topicFamily,
        Integer eventId,
        String replyId,
        String requestId,
        String status,
        String result,
        String reasonId,
        Integer actionId,
        Integer progressId,
        String firmwareState,
        String sessionId,
        Long tsMs,
        Instant receivedAt,
        String payloadJson
) {
}