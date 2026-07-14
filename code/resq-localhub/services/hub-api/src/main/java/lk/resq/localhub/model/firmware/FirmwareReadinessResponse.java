package lk.resq.localhub.model.firmware;

public record FirmwareReadinessResponse(
        String deviceId,
        String firmwareState,
        boolean calibrated,
        boolean readyForSession,
        String latestResult,
        Integer progressId,
        String reasonId,
        Integer actionId,
        Long tsMs,
        String receivedAt,
        String sessionId,
        String lastErrorId,
        String bootId,
        Long stateSeq,
        RuntimeOrderingConfidence orderingConfidence,
        Integer calibrationSchemaVersion,
        Integer calibrationGeneration,
        String calibrationStorageStatus,
        Boolean recalibrationRequired,
        Integer profileVersion,
        String profileHash
) {
    public FirmwareReadinessResponse(
            String deviceId,
            String firmwareState,
            boolean calibrated,
            boolean readyForSession,
            String latestResult,
            Integer progressId,
            String reasonId,
            Integer actionId,
            Long tsMs,
            String receivedAt,
            String sessionId,
            String lastErrorId
    ) {
        this(
                deviceId,
                firmwareState,
                calibrated,
                readyForSession,
                latestResult,
                progressId,
                reasonId,
                actionId,
                tsMs,
                receivedAt,
                sessionId,
                lastErrorId,
                null,
                null,
                RuntimeOrderingConfidence.UNKNOWN,
                null,
                null,
                null,
                null,
                null,
                null
        );
    }
}
