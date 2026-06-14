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
        String source
) {
}
