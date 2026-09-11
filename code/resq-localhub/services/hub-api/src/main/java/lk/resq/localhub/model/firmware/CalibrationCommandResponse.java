package lk.resq.localhub.model.firmware;

import java.time.Instant;

public record CalibrationCommandResponse(
        String deviceId,
        String requestId,
        String command,
        String status,
        String message,
        Instant issuedAt
) {
}
