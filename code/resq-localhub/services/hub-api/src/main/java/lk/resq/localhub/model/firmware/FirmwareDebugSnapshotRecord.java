package lk.resq.localhub.model.firmware;

import java.time.Instant;

public record FirmwareDebugSnapshotRecord(
        long id,
        String deviceId,
        String requestId,
        Integer pressure0Raw,
        Integer pressure1Raw,
        Integer pressure2Raw,
        Integer hallRaw,
        Long tsMs,
        Instant receivedAt,
        String payloadJson
) {
}