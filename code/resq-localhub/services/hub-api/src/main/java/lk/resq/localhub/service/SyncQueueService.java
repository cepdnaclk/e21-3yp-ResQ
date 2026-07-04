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
    private final RosterCacheRepository rosterCacheRepository;

    @org.springframework.beans.factory.annotation.Autowired
    public SyncQueueService(
            SyncQueueRepository syncQueueRepository,
            ObjectMapper objectMapper,
            CloudSessionSummaryPayloadMapper payloadMapper,
            RosterCacheRepository rosterCacheRepository
    ) {
        this.syncQueueRepository = syncQueueRepository;
        this.objectMapper = objectMapper;
        this.payloadMapper = payloadMapper;
        this.rosterCacheRepository = rosterCacheRepository;
    }

    public SyncQueueService(
            SyncQueueRepository syncQueueRepository,
            ObjectMapper objectMapper,
            CloudSessionSummaryPayloadMapper payloadMapper
    ) {
        this.syncQueueRepository = syncQueueRepository;
        this.objectMapper = objectMapper;
        this.payloadMapper = payloadMapper;
        this.rosterCacheRepository = null;
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

    public java.util.Optional<SyncQueueItem> findById(String id) {
        return syncQueueRepository.findById(id);
    }

    public boolean requeueItem(String id) {
        return syncQueueRepository.requeue(id);
    }

    public int requeueAllFailed() {
        List<SyncQueueItem> items = syncQueueRepository.findFailedAndDeferred();
        int requeuedCount = 0;
        for (SyncQueueItem item : items) {
            String validationError = getValidationError(item.payloadJson());
            if (validationError == null) {
                if (syncQueueRepository.requeue(item.id())) {
                    requeuedCount++;
                }
            }
        }
        return requeuedCount;
    }

    public void markSkipped(String id, String reason, Instant attemptedAt) {
        syncQueueRepository.markSkipped(id, reason, attemptedAt);
    }

    public String getValidationError(String payloadJson) {
        try {
            CloudSessionSummarySyncPayload payload = objectMapper.readValue(payloadJson, CloudSessionSummarySyncPayload.class);
            
            if (payload.courseId() != null && !payload.courseId().isBlank() && !isValidUuid(payload.courseId())) {
                return "Session contains local-only user IDs and cannot be synced to cloud.";
            }
            if (payload.traineeId() != null && !payload.traineeId().isBlank() && !isValidUuid(payload.traineeId())) {
                return "Session contains local-only user IDs and cannot be synced to cloud.";
            }
            if (payload.instructorId() != null && !payload.instructorId().isBlank() && !isValidUuid(payload.instructorId())) {
                return "Session contains local-only user IDs and cannot be synced to cloud.";
            }
            
            String courseId = payload.courseId();
            if (courseId != null && !courseId.isBlank()) {
                if (rosterCacheRepository != null) {
                    if (!rosterCacheRepository.existsActiveCourse(courseId)) {
                        return "Session contains user/course IDs that are not valid in the current cloud roster.";
                    }
                    
                    String traineeId = payload.traineeId();
                    if (traineeId != null && !traineeId.isBlank()) {
                        if (!rosterCacheRepository.existsActiveCloudUser(traineeId, java.util.Set.of("TRAINEE"))
                                || !rosterCacheRepository.isTraineeEnrolledInCourse(courseId, traineeId)) {
                            return "Session contains user/course IDs that are not valid in the current cloud roster.";
                        }
                    }
                    
                    String instructorId = payload.instructorId();
                    if (instructorId != null && !instructorId.isBlank()) {
                        if (!rosterCacheRepository.existsActiveCloudUser(instructorId, java.util.Set.of("INSTRUCTOR", "ADMIN"))
                                || !rosterCacheRepository.isInstructorAssignedToCourse(courseId, instructorId)) {
                            return "Session contains user/course IDs that are not valid in the current cloud roster.";
                        }
                    }
                }
            }
            return null;
        } catch (Exception e) {
            return "Session contains local-only user IDs and cannot be synced to cloud.";
        }
    }
    
    private boolean isValidUuid(String value) {
        if (value == null) return false;
        try {
            UUID.fromString(value);
            return true;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    private String toPayloadJson(CloudSessionSummarySyncPayload payload) {
        try {
            return objectMapper.writeValueAsString(payload);
        } catch (com.fasterxml.jackson.core.JsonProcessingException error) {
            throw new IllegalStateException("Failed to serialize session summary payload for sync queue", error);
        }
    }
}
