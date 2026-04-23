package lk.resq.localhub.model;

import java.time.Instant;

public record SessionLiveView(
        String sessionId,
        String deviceId,
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
        String lastEventType
) {
}
