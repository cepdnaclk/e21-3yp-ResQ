package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.localhub.model.SessionEndResponse;
import lk.resq.localhub.model.SyncEntityType;
import lk.resq.localhub.model.SyncQueueItem;
import lk.resq.localhub.model.SyncStatus;
import lk.resq.localhub.model.cloudsync.CloudSessionSummarySyncPayload;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class SyncQueueService {

    private final SyncQueueRepository syncQueueRepository;
    private final ObjectMapper objectMapper;
    private final CloudSessionSummaryPayloadMapper payloadMapper;

    public SyncQueueService(
            SyncQueueRepository syncQueueRepository,
            ObjectMapper objectMapper,
            CloudSessionSummaryPayloadMapper payloadMapper
    ) {
        this.syncQueueRepository = syncQueueRepository;
        this.objectMapper = objectMapper;
        this.payloadMapper = payloadMapper;
    }

    public void enqueueSessionSummary(SessionEndResponse session) {
        Instant now = Instant.now();
        CloudSessionSummarySyncPayload payload = payloadMapper.map(session, now);
        SyncQueueItem item = new SyncQueueItem(
                UUID.randomUUID().toString(),
                SyncEntityType.SESSION_SUMMARY,
                payload.localSessionId(),
                toPayloadJson(payload),
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

    public List<SyncQueueItem> findRetryableItems(Instant now, int limit) {
        return syncQueueRepository.findRetryableItems(now, limit);
    }

    public boolean markSyncing(String id, Instant attemptedAt) {
        return syncQueueRepository.markSyncing(id, attemptedAt);
    }

    public void markSynced(String id, Instant syncedAt) {
        syncQueueRepository.markSynced(id, syncedAt);
    }

    public void markRetryLater(String id, int retryCount, String lastError, Instant attemptedAt) {
        syncQueueRepository.markRetryLater(id, retryCount, lastError, attemptedAt);
    }

    public void markFailed(String id, int retryCount, String lastError, Instant attemptedAt) {
        syncQueueRepository.markFailed(id, retryCount, lastError, attemptedAt);
    }

    private String toPayloadJson(CloudSessionSummarySyncPayload payload) {
        try {
            return objectMapper.writeValueAsString(payload);
        } catch (com.fasterxml.jackson.core.JsonProcessingException error) {
            throw new IllegalStateException("Failed to serialize session summary payload for sync queue", error);
        }
    }
}
