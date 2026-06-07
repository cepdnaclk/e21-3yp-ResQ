package lk.resq.localhub.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.localhub.model.SessionEndResponse;
import lk.resq.localhub.model.SyncEntityType;
import lk.resq.localhub.model.SyncQueueItem;
import lk.resq.localhub.model.SyncStatus;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class SyncQueueService {

    private final SyncQueueRepository syncQueueRepository;
    private final ObjectMapper objectMapper;

    public SyncQueueService(SyncQueueRepository syncQueueRepository, ObjectMapper objectMapper) {
        this.syncQueueRepository = syncQueueRepository;
        this.objectMapper = objectMapper;
    }

    public void enqueueSessionSummary(SessionEndResponse session) {
        Instant now = Instant.now();
        SyncQueueItem item = new SyncQueueItem(
                UUID.randomUUID().toString(),
                SyncEntityType.SESSION_SUMMARY,
                session.sessionId(),
                toSessionSummaryPayloadJson(session),
                SyncStatus.PENDING,
                0,
                null,
                now,
                null,
                null
        );

        syncQueueRepository.save(item);
    }

    public List<SyncQueueItem> listRecentItems(int limit) {
        return syncQueueRepository.findRecent(limit);
    }

    private String toSessionSummaryPayloadJson(SessionEndResponse session) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("entityType", SyncEntityType.SESSION_SUMMARY.name());
        payload.put("sessionId", session.sessionId());
        payload.put("deviceId", session.deviceId());
        payload.put("manikinId", null);
        payload.put("traineeId", session.traineeId());
        payload.put("instructorId", null);
        payload.put("startTime", session.startedAt() == null ? null : session.startedAt().toString());
        payload.put("endTime", session.endedAt() == null ? null : session.endedAt().toString());
        payload.put("status", session.ended() ? "COMPLETED" : "ACTIVE");
        payload.put("result", session.ended() ? "COMPLETED" : "UNKNOWN");
        payload.put("totalCompressions", session.summary().totalCompressions());
        payload.put("validCompressions", session.summary().validCompressions());
        payload.put("sampleCount", session.summary().sampleCount());
        payload.put("durationSeconds", session.summary().durationSeconds());
        payload.put("avgDepthMm", session.summary().avgDepthMm());
        payload.put("avgDepthProgress", session.summary().avgDepthProgress());
        payload.put("avgRateCpm", session.summary().avgRateCpm());
        payload.put("recoilPct", session.summary().recoilPct());
        payload.put("recoilOkCount", session.summary().recoilOkCount());
        payload.put("incompleteRecoilCount", session.summary().incompleteRecoilCount());
        payload.put("pausesCount", session.summary().pausesCount());
        payload.put("score", session.summary().score());
        payload.put("latestFlags", session.summary().latestFlags());
        payload.put("notes", session.notes());
        payload.put("scenario", session.scenario());
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("sessionId", session.summary().sessionId());
        summary.put("deviceId", session.summary().deviceId());
        summary.put("traineeId", session.summary().traineeId());
        summary.put("startedAt", session.summary().startedAt() == null ? null : session.summary().startedAt().toString());
        summary.put("endedAt", session.summary().endedAt() == null ? null : session.summary().endedAt().toString());
        summary.put("durationSeconds", session.summary().durationSeconds());
        summary.put("sampleCount", session.summary().sampleCount());
        summary.put("totalCompressions", session.summary().totalCompressions());
        summary.put("validCompressions", session.summary().validCompressions());
        summary.put("avgDepthMm", session.summary().avgDepthMm());
        summary.put("avgDepthProgress", session.summary().avgDepthProgress());
        summary.put("avgRateCpm", session.summary().avgRateCpm());
        summary.put("recoilPct", session.summary().recoilPct());
        summary.put("recoilOkCount", session.summary().recoilOkCount());
        summary.put("incompleteRecoilCount", session.summary().incompleteRecoilCount());
        summary.put("pausesCount", session.summary().pausesCount());
        summary.put("score", session.summary().score());
        summary.put("latestFlags", session.summary().latestFlags());
        payload.put("summary", summary);

        try {
            return objectMapper.writeValueAsString(payload);
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Failed to serialize session summary payload for sync queue", error);
        }
    }
}
