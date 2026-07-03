package lk.resq.localhub.model.firmware;

import java.time.Instant;

public record DeviceReadinessState(
        String deviceId,
        CalibrationState calibrationState,
        String firmwareState,
        Integer currentProgressId,
        String lastReasonId,
        Integer lastActionId,
        String lastResult,
        String lastReplyId,
        boolean readyForSession,
        Instant lastUpdatedAt
) {
}
