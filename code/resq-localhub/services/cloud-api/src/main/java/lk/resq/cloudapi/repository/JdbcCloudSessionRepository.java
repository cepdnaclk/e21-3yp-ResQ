package lk.resq.cloudapi.repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.cloudapi.model.CloudSessionRecord;
import lk.resq.cloudapi.model.CloudSessionSummarySyncPayload;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public class JdbcCloudSessionRepository implements CloudSessionRepository {

    private static final String SELECT_COLUMNS = """
            SELECT cloud_session_id, idempotency_key, payload_json, received_at, updated_at
            FROM cloud_session_summaries
            """;

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;
    private final RowMapper<CloudSessionRecord> rowMapper = this::mapRow;

    public JdbcCloudSessionRepository(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    @Override
    @Transactional
    public synchronized SaveResult save(CloudSessionRecord candidate) {
        Optional<CloudSessionRecord> existing = findByIdempotencyKey(candidate.idempotencyKey());
        if (existing.isPresent()) {
            CloudSessionRecord updated = update(existing.orElseThrow(), candidate);
            return new SaveResult(updated, false);
        }

        try {
            insert(candidate);
            return new SaveResult(candidate, true);
        } catch (DuplicateKeyException race) {
            CloudSessionRecord stored = findByIdempotencyKey(candidate.idempotencyKey()).orElseThrow();
            return new SaveResult(update(stored, candidate), false);
        }
    }

    @Override
    public Optional<CloudSessionRecord> findByIdempotencyKey(String idempotencyKey) {
        return jdbcTemplate.query(
                SELECT_COLUMNS + " WHERE idempotency_key = ?",
                rowMapper,
                idempotencyKey
        ).stream().findFirst();
    }

    @Override
    public Optional<CloudSessionRecord> findByCloudSessionId(String cloudSessionId) {
        return jdbcTemplate.query(
                SELECT_COLUMNS + " WHERE cloud_session_id = ?",
                rowMapper,
                UUID.fromString(cloudSessionId)
        ).stream().findFirst();
    }

    @Override
    public List<CloudSessionRecord> findAll() {
        return jdbcTemplate.query(SELECT_COLUMNS + " ORDER BY received_at", rowMapper);
    }

    private void insert(CloudSessionRecord record) {
        CloudSessionSummarySyncPayload payload = record.payload();
        jdbcTemplate.update("""
                        INSERT INTO cloud_session_summaries (
                            cloud_session_id, idempotency_key, local_hub_id, local_session_id,
                            contract_version, entity_type, device_id, manikin_id, trainee_id,
                            instructor_id, session_status, started_at, ended_at, duration_ms,
                            total_compressions, valid_compressions, avg_depth_mm, avg_rate_cpm,
                            recoil_ok_pct, pause_count, score, source, payload_json,
                            received_at, updated_at
                        ) VALUES (
                            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                            CAST(? AS JSONB), ?, ?
                        )
                        """,
                UUID.fromString(record.cloudSessionId()),
                record.idempotencyKey(),
                normalizedLocalHubId(payload.localHubId()),
                payload.localSessionId().trim(),
                payload.contractVersion(),
                payload.entityType().name(),
                payload.deviceId(),
                payload.manikinId(),
                payload.traineeId(),
                payload.instructorId(),
                payload.status(),
                timestamp(payload.startedAt()),
                timestamp(payload.endedAt()),
                payload.durationMs(),
                payload.totalCompressions(),
                payload.validCompressions(),
                payload.avgDepthMm(),
                payload.avgRateCpm(),
                payload.recoilOkPct(),
                payload.pauseCount(),
                payload.score(),
                payload.source(),
                toJson(payload),
                timestamp(record.createdAt()),
                timestamp(record.updatedAt())
        );
    }

    private CloudSessionRecord update(CloudSessionRecord existing, CloudSessionRecord candidate) {
        CloudSessionSummarySyncPayload payload = candidate.payload();
        jdbcTemplate.update("""
                        UPDATE cloud_session_summaries SET
                            local_hub_id = ?, local_session_id = ?, contract_version = ?,
                            entity_type = ?, device_id = ?, manikin_id = ?, trainee_id = ?,
                            instructor_id = ?, session_status = ?, started_at = ?, ended_at = ?,
                            duration_ms = ?, total_compressions = ?, valid_compressions = ?,
                            avg_depth_mm = ?, avg_rate_cpm = ?, recoil_ok_pct = ?, pause_count = ?,
                            score = ?, source = ?, payload_json = CAST(? AS JSONB), updated_at = ?
                        WHERE idempotency_key = ?
                        """,
                normalizedLocalHubId(payload.localHubId()),
                payload.localSessionId().trim(),
                payload.contractVersion(),
                payload.entityType().name(),
                payload.deviceId(),
                payload.manikinId(),
                payload.traineeId(),
                payload.instructorId(),
                payload.status(),
                timestamp(payload.startedAt()),
                timestamp(payload.endedAt()),
                payload.durationMs(),
                payload.totalCompressions(),
                payload.validCompressions(),
                payload.avgDepthMm(),
                payload.avgRateCpm(),
                payload.recoilOkPct(),
                payload.pauseCount(),
                payload.score(),
                payload.source(),
                toJson(payload),
                timestamp(candidate.updatedAt()),
                existing.idempotencyKey()
        );
        return new CloudSessionRecord(
                existing.cloudSessionId(),
                existing.idempotencyKey(),
                payload,
                existing.createdAt(),
                candidate.updatedAt()
        );
    }

    private CloudSessionRecord mapRow(ResultSet resultSet, int rowNumber) throws SQLException {
        try {
            return new CloudSessionRecord(
                    resultSet.getObject("cloud_session_id", UUID.class).toString(),
                    resultSet.getString("idempotency_key"),
                    readPayload(resultSet.getString("payload_json")),
                    resultSet.getObject("received_at", java.time.OffsetDateTime.class).toInstant(),
                    resultSet.getObject("updated_at", java.time.OffsetDateTime.class).toInstant()
            );
        } catch (JsonProcessingException exception) {
            throw new SQLException("Could not deserialize stored session payload", exception);
        }
    }

    private CloudSessionSummarySyncPayload readPayload(String storedJson) throws JsonProcessingException {
        JsonNode node = objectMapper.readTree(storedJson);
        if (node.isTextual()) {
            node = objectMapper.readTree(node.textValue());
        }
        return objectMapper.treeToValue(node, CloudSessionSummarySyncPayload.class);
    }

    private String toJson(CloudSessionSummarySyncPayload payload) {
        try {
            return objectMapper.writeValueAsString(payload);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Could not serialize session payload", exception);
        }
    }

    private static Timestamp timestamp(Instant value) {
        return value == null ? null : Timestamp.from(value);
    }

    private static String normalizedLocalHubId(String localHubId) {
        return localHubId == null || localHubId.isBlank()
                ? "UNASSIGNED_LOCAL_HUB"
                : localHubId.trim();
    }
}
