package lk.resq.localhub.model.firmware;

import java.time.Instant;

public record CalibrationEvidence(
        Long id,
        String deviceId,
        String requestId,
        Instant startedAt,
        Instant completedAt,
        String finalResult,
        String calibrationState,
        Boolean readyForSessionAtCompletion,
        Integer lastProgressId,
        String lastReasonId,
        Integer lastActionId,
        String firmwareState,
        String profileId,
        Integer hallDelta,
        Integer refPressure,
        Integer bladder1Pressure,
        Integer bladder2Pressure,
        Integer sampleIntervalMs,
        Integer calibrationWindowMs,
        String createdByUsername,
        Instant createdAt,
        Instant updatedAt
) {
}
