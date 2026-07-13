package lk.resq.localhub.model;

import java.time.Instant;

public record DurableSessionRuntimeRecord(
        String sessionId,
        String deviceId,
        String traineeId,
        String profileId,
        String scenario,
        String notes,
        String courseId,
        String instructorId,
        SessionLifecycleState lifecycleState,
        boolean active,
        Instant startedAt,
        Instant updatedAt,
        Instant endedAt,
        String startRequestId,
        Instant startRequestedAt,
        Instant startDeadline,
        String stopRequestId,
        Instant stopRequestedAt,
        Instant stopDeadline,
        String rejectionReason,
        String firmwareReasonId,
        Integer firmwareActionId,
        Long lastAcceptedTelemetrySeq,
        String accumulatorSnapshotJson,
        boolean completedPersisted,
        boolean syncQueued,
        SessionRecoveryStatus recoveryStatus,
        Instant recoveryStartedAt,
        Instant recoveryDeadline,
        String recoveryReason
) {
}
