package lk.resq.cloudapi.service;

import lk.resq.cloudapi.model.CloudSessionRecord;
import lk.resq.cloudapi.model.CloudSessionSummarySyncPayload;
import lk.resq.cloudapi.model.CloudSessionSyncResponse;
import lk.resq.cloudapi.model.CloudSyncContractVersion;
import lk.resq.cloudapi.model.CloudSyncEntityType;
import lk.resq.cloudapi.repository.CloudSessionRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class CloudSessionSyncService {

    public static final String UNASSIGNED_LOCAL_HUB = "UNASSIGNED_LOCAL_HUB";

    private final CloudSessionRepository repository;

    public CloudSessionSyncService(CloudSessionRepository repository) {
        this.repository = repository;
    }

    public CloudSessionSyncResponse accept(CloudSessionSummarySyncPayload payload) {
        validate(payload);
        String idempotencyKey = idempotencyKey(payload.localHubId(), payload.localSessionId());
        Instant now = Instant.now();
        CloudSessionRecord candidate = new CloudSessionRecord(
                UUID.randomUUID().toString(),
                idempotencyKey,
                payload,
                now,
                now
        );
        CloudSessionRepository.SaveResult saved = repository.saveIfAbsent(candidate);
        String result = saved.created() ? "CREATED" : "ALREADY_EXISTS";

        return new CloudSessionSyncResponse(
                true,
                result,
                saved.record().cloudSessionId(),
                idempotencyKey,
                CloudSyncContractVersion.CURRENT,
                saved.created() ? "Session summary accepted" : "Session summary already accepted"
        );
    }

    public CloudSessionRecord findByLocalIdentity(String localHubId, String localSessionId) {
        return repository.findByIdempotencyKey(idempotencyKey(localHubId, localSessionId))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Session summary not found"));
    }

    public List<CloudSessionRecord> findAll() {
        return repository.findAll();
    }

    public CloudSessionRecord findByCloudSessionId(String cloudSessionId) {
        return repository.findByCloudSessionId(cloudSessionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Cloud session not found"));
    }

    private static void validate(CloudSessionSummarySyncPayload payload) {
        if (payload == null) {
            throw badRequest("Request body is required");
        }
        if (!CloudSyncContractVersion.CURRENT.equals(payload.contractVersion())) {
            throw badRequest("contractVersion must be " + CloudSyncContractVersion.CURRENT);
        }
        if (payload.entityType() != CloudSyncEntityType.SESSION_SUMMARY) {
            throw badRequest("entityType must be SESSION_SUMMARY");
        }
        if (isBlank(payload.localSessionId())) {
            throw badRequest("localSessionId is required");
        }
    }

    private static String idempotencyKey(String localHubId, String localSessionId) {
        if (isBlank(localSessionId)) {
            throw badRequest("localSessionId is required");
        }
        String hubIdentity = isBlank(localHubId) ? UNASSIGNED_LOCAL_HUB : localHubId.trim();
        return hubIdentity + ":" + localSessionId.trim();
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private static ResponseStatusException badRequest(String reason) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, reason);
    }
}
