package lk.resq.localhub.model.firmware;

public record DeviceRuntimeState(
        String deviceId,
        String firmwareState,
        boolean calibrated,
        boolean readyForSession,
        String calibrationState,
        String lastCalibrationResult,
        String calibrationProfileId,
        String sessionId,
        boolean sessionActive,
        long firmwareTimestampMs,
        long lastSeenEpochMs,
        RuntimeStateSource lastSource,
        String readinessReason,
        Integer currentProgressId,
        String lastReasonId,
        Integer lastActionId,
        String lastReplyId
) {
}
