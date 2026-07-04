package lk.resq.localhub.model.cloudsync;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonFormat;

import java.time.Instant;

@JsonIgnoreProperties(ignoreUnknown = true)
@JsonInclude(JsonInclude.Include.NON_NULL)
public record CloudSessionSummarySyncPayload(
        String contractVersion,
        CloudSyncEntityType entityType,
        String localHubId,
        String localSessionId,
        String sessionId,
        String deviceId,
        String manikinId,
        String traineeId,
        String instructorId,
        String courseId,
        @JsonFormat(shape = JsonFormat.Shape.STRING)
        Instant startedAt,
        @JsonFormat(shape = JsonFormat.Shape.STRING)
        Instant endedAt,
        Long durationMs,
        String status,
        String result,
        Integer totalCompressions,
        Integer validCompressions,
        Double avgDepthMm,
        Double avgRateCpm,
        Double recoilOkPct,
        Integer recoilOkCount,
        Integer incompleteRecoilCount,
        Integer pauseCount,
        Integer score,
        String flags,
        String summaryNotes,
        String scenario,
        String source,
        @JsonFormat(shape = JsonFormat.Shape.STRING)
        Instant generatedAt
) {
}
