package lk.resq.cloudapi.repository;

import lk.resq.cloudapi.model.CloudSessionRecord;

import java.util.List;
import java.util.Optional;

public interface CloudSessionRepository {

    SaveResult saveIfAbsent(CloudSessionRecord record);

    Optional<CloudSessionRecord> findByIdempotencyKey(String idempotencyKey);

    Optional<CloudSessionRecord> findByCloudSessionId(String cloudSessionId);

    List<CloudSessionRecord> findAll();

    record SaveResult(CloudSessionRecord record, boolean created) {
    }
}
