package lk.resq.cloudapi.repository;

import lk.resq.cloudapi.model.CloudSessionRecord;
import org.springframework.stereotype.Repository;

import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.atomic.AtomicBoolean;

@Repository
public class InMemoryCloudSessionRepository implements CloudSessionRepository {

    private final ConcurrentMap<String, CloudSessionRecord> recordsByIdempotencyKey = new ConcurrentHashMap<>();
    private final ConcurrentMap<String, CloudSessionRecord> recordsByCloudSessionId = new ConcurrentHashMap<>();

    @Override
    public SaveResult saveIfAbsent(CloudSessionRecord record) {
        AtomicBoolean created = new AtomicBoolean(false);
        CloudSessionRecord stored = recordsByIdempotencyKey.computeIfAbsent(record.idempotencyKey(), key -> {
            recordsByCloudSessionId.put(record.cloudSessionId(), record);
            created.set(true);
            return record;
        });
        return new SaveResult(stored, created.get());
    }

    @Override
    public Optional<CloudSessionRecord> findByIdempotencyKey(String idempotencyKey) {
        return Optional.ofNullable(recordsByIdempotencyKey.get(idempotencyKey));
    }

    @Override
    public Optional<CloudSessionRecord> findByCloudSessionId(String cloudSessionId) {
        return Optional.ofNullable(recordsByCloudSessionId.get(cloudSessionId));
    }

    @Override
    public List<CloudSessionRecord> findAll() {
        return recordsByIdempotencyKey.values().stream()
                .sorted(Comparator.comparing(CloudSessionRecord::createdAt))
                .toList();
    }
}
