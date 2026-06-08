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

    private String toPayloadJson(CloudSessionSummarySyncPayload payload) {
        try {
            return objectMapper.writeValueAsString(payload);
        } catch (com.fasterxml.jackson.core.JsonProcessingException error) {
            throw new IllegalStateException("Failed to serialize session summary payload for sync queue", error);
        }
    }
}
