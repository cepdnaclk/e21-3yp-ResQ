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
        Instant lastUpdatedAt,
        Integer calibrationSchemaVersion,
        Integer calibrationGeneration,
        String calibrationStorageStatus,
        Boolean recalibrationRequired,
        Integer profileVersion,
        String profileHash
) {
    public DeviceReadinessState(
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
        this(
                deviceId,
                calibrationState,
                firmwareState,
                currentProgressId,
                lastReasonId,
                lastActionId,
                lastResult,
                lastReplyId,
                readyForSession,
                lastUpdatedAt,
                null,
                null,
                null,
                null,
                null,
                null
        );
    }
}
