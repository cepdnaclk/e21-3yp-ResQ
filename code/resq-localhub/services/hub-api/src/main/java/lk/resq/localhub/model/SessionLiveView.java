package lk.resq.localhub.model;

import java.time.Instant;

public record SessionLiveView(
        String sessionId,
        String deviceId,
        String manikinId,
        String traineeId,
        boolean active,
        Instant startedAt,
        String scenario,
        String notes,
        Instant lastSeen,
        String state,
        boolean online,
        String ip,
        String fw,
        Integer rssi,
        Integer battery,
        Boolean sessionActive,
        Double latestDepthMm,
        Double latestRateCpm,
        Boolean latestRecoilOk,
        Double latestPauseS,
        String latestFlags,
        String lastEventType,
        Long latestForce1,
        Long latestForce2,
        Double pressureBalancePct,
        Boolean pressureSkewed,
        LiveMetricPayload latestMetric,
        Long seq,
        String connectionState,
        boolean stale,
        boolean offline
) {
}
