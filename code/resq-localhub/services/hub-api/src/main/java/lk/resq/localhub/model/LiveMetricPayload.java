package lk.resq.localhub.model;

public record LiveMetricPayload(
        String deviceId,
        String manikinId,
        String sessionId,
        Long seq,
        Long tsMs,
        Object timestamp,
        Double depthMm,
        Double depthProgress,
        Boolean depthOk,
        Double rateCpm,
        Boolean recoilOk,
        Double pauseS,
        Integer compressionCount,
        Integer validCompressionCount,
        Integer recoilOkCount,
        Integer incompleteRecoilCount,
        String handPlacement,
        Object flags,
        Double pressureBalancePct,
        String sourceMode,
        Object debugRaw
) {
}
