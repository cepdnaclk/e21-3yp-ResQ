package lk.resq.localhub.model;

public record LiveMetricPayload(
        String deviceId,
        String manikinId,
        String sessionId,
        Long seq,
        Long tsMs,
        Object timestamp,
        Double depthMm,
        Double rateCpm,
        Boolean recoilOk,
        Double pauseS,
        Integer compressionCount,
        String handPlacement,
        Object flags,
        String sourceMode,
        Object debugRaw
) {
}
