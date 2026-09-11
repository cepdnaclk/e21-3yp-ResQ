package lk.resq.localhub.model.firmware;

import java.time.Instant;

public record SensorStreamCommandUpdate(
        String type,
        String deviceId,
        String requestId,
        String action,
        String status,
        String reasonId,
        String firmwareState,
        String streamState,
        Instant receivedAt
) {
}
