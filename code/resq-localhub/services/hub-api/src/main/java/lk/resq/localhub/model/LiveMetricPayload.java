package lk.resq.localhub.model;

public record LiveMetricPayload(
        String deviceId,
        String manikinId,
        String sessionId,
        Long seq,
        Long tsMs,
        Object timestamp,
        Double depthMm,
        Double depthMmScored,
        Double depthProgress,
        Boolean depthOk,
        Double rateCpm,
        Boolean recoilOk,
        Double recoilPct,
        Double recoilPctScored,
        Double pauseS,
        Integer compressionCount,
        Integer completedCompressionCount,
        Integer depthOkCompressionCount,
        Integer validCompressionCount,
        Double lastCompressionPeakDepthMm,
        Double averageCompletedCompressionPeakDepthMm,
        Integer recoilOkCount,
        Integer incompleteRecoilCount,
        String handPlacement,
        Object flags,
        Double pressureBalanceScorePct,
        String sourceMode
) {
    /** Backward-compatible constructor for callers without explicit scoring fields. */
    public LiveMetricPayload(
            String deviceId, String manikinId, String sessionId, Long seq, Long tsMs,
            Object timestamp, Double depthMm, Double depthProgress, Boolean depthOk,
            Double rateCpm, Boolean recoilOk, Double recoilPct, Double pauseS,
            Integer compressionCount, Integer completedCompressionCount,
            Integer depthOkCompressionCount, Integer validCompressionCount,
            Double lastCompressionPeakDepthMm,
            Double averageCompletedCompressionPeakDepthMm, Integer recoilOkCount,
            Integer incompleteRecoilCount, String handPlacement, Object flags,
            Double pressureBalanceScorePct, String sourceMode
    ) {
        this(deviceId, manikinId, sessionId, seq, tsMs, timestamp, depthMm, null,
                depthProgress, depthOk, rateCpm, recoilOk, recoilPct, null, pauseS,
                compressionCount, completedCompressionCount, depthOkCompressionCount,
                validCompressionCount, lastCompressionPeakDepthMm,
                averageCompletedCompressionPeakDepthMm, recoilOkCount,
                incompleteRecoilCount, handPlacement, flags,
                pressureBalanceScorePct, sourceMode);
    }
}
