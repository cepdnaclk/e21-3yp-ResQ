package lk.resq.localhub.model;

import java.time.Instant;

public record ManikinLiveSummary(
        String deviceId,
        boolean online,
        Instant lastSeen,
        String state,
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
        String activeSessionId,
        String activeTraineeId,
        Instant activeSessionStartedAt,
        String activeSessionScenario
) {
}
