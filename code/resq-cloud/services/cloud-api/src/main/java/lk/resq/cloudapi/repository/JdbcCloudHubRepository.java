package lk.resq.cloudapi.repository;

import lk.resq.cloudapi.model.CloudHubApiKey;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

@Repository
public class JdbcCloudHubRepository implements CloudHubRepository {

    private static final String HUB_SELECT = """
            SELECT hub_id, hub_name, key_hash, active, created_at, updated_at, last_used_at
            FROM cloud_hub_api_keys
            """;

    private final JdbcTemplate jdbcTemplate;
    private final RowMapper<CloudHubApiKey> hubMapper = this::mapHub;

    public JdbcCloudHubRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public Optional<CloudHubApiKey> findActiveHubById(String hubId) {
        return first(jdbcTemplate.query(
                HUB_SELECT + " WHERE hub_id = ? AND active = TRUE",
                hubMapper,
                hubId
        ));
    }

    @Override
    public void updateLastUsed(String hubId, Instant lastUsedAt) {
        jdbcTemplate.update(
                "UPDATE cloud_hub_api_keys SET last_used_at = ? WHERE hub_id = ?",
                Timestamp.from(lastUsedAt),
                hubId
        );
    }

    @Override
    public List<String> findActiveCourseIdsByHubId(String hubId) {
        return jdbcTemplate.queryForList(
                """
                SELECT course_id::TEXT
                FROM cloud_hub_course_assignments
                WHERE hub_id = ? AND active = TRUE
                """,
                String.class,
                hubId
        );
    }

    // -------------------------------------------------------------------------
    // Mappers
    // -------------------------------------------------------------------------

    private CloudHubApiKey mapHub(ResultSet rs, int rowNumber) throws SQLException {
        return new CloudHubApiKey(
                rs.getString("hub_id"),
                rs.getString("hub_name"),
                rs.getString("key_hash"),
                rs.getBoolean("active"),
                instant(rs, "created_at"),
                instant(rs, "updated_at"),
                nullableInstant(rs, "last_used_at")
        );
    }

    // -------------------------------------------------------------------------
    // Helpers (same pattern as JdbcCloudManagementRepository)
    // -------------------------------------------------------------------------

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        return rs.getObject(column, java.time.OffsetDateTime.class).toInstant();
    }

    private static Instant nullableInstant(ResultSet rs, String column) throws SQLException {
        java.time.OffsetDateTime value = rs.getObject(column, java.time.OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }

    private static <T> Optional<T> first(List<T> values) {
        return values.stream().findFirst();
    }
}
