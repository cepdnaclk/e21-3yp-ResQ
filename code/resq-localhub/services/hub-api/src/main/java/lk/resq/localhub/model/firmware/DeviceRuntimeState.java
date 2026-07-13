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
        String lastReplyId,
        String bootId,
        Long stateSeq,
        RuntimeOrderingConfidence orderingConfidence
) {
    public DeviceRuntimeState(
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
        this(
                deviceId,
                firmwareState,
                calibrated,
                readyForSession,
                calibrationState,
                lastCalibrationResult,
                calibrationProfileId,
                sessionId,
                sessionActive,
                firmwareTimestampMs,
                lastSeenEpochMs,
                lastSource,
                readinessReason,
                currentProgressId,
                lastReasonId,
                lastActionId,
                lastReplyId,
                null,
                null,
                RuntimeOrderingConfidence.UNKNOWN
        );
    }
}
