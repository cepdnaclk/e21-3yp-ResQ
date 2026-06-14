package lk.resq.localhub.service;

import lk.resq.localhub.model.SyncEntityType;
import lk.resq.localhub.model.SyncQueueItem;
import lk.resq.localhub.model.SyncStatus;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Repository;

import jakarta.annotation.PostConstruct;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

@Repository
public class SyncQueueRepository {

    private final Path databasePath;
    private final String jdbcUrl;

    public SyncQueueRepository(@Value("${resq.storage.sqlite-path:${user.home}/.resq-localhub/hub-api.sqlite}") String sqlitePath) {
        this.databasePath = Path.of(sqlitePath).toAbsolutePath();
        this.jdbcUrl = "jdbc:sqlite:" + this.databasePath.toString().replace("\\", "/");
    }

    @PostConstruct
    public void initialize() {
        try {
            Path parent = databasePath.getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }

            try (Connection connection = openConnection(); Statement statement = connection.createStatement()) {
                statement.executeUpdate("PRAGMA foreign_keys = ON");
                statement.executeUpdate("""
                        CREATE TABLE IF NOT EXISTS sync_queue (
                          id TEXT PRIMARY KEY,
                          entity_type TEXT NOT NULL,
                          entity_id TEXT NOT NULL,
                          payload_json TEXT NOT NULL,
                          sync_status TEXT NOT NULL,
                          retry_count INTEGER NOT NULL DEFAULT 0,
                          last_error TEXT,
                          created_at TEXT NOT NULL,
                          last_attempt_at TEXT,
                          synced_at TEXT
                        )
                        """);
                statement.executeUpdate("CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_queue_entity_type_entity_id ON sync_queue(entity_type, entity_id)");
                statement.executeUpdate("CREATE INDEX IF NOT EXISTS idx_sync_queue_status_created_at ON sync_queue(sync_status, created_at DESC)");
            }
        } catch (IOException | SQLException error) {
            throw new IllegalStateException("Failed to initialize sync queue store at " + databasePath, error);
        }
    }

    public synchronized void save(SyncQueueItem item) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO sync_queue (
                  id, entity_type, entity_id, payload_json, sync_status, retry_count, last_error, created_at, last_attempt_at, synced_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                  payload_json = excluded.payload_json,
                  sync_status = excluded.sync_status,
                  retry_count = excluded.retry_count,
                  last_error = excluded.last_error,
                  last_attempt_at = excluded.last_attempt_at,
                  synced_at = excluded.synced_at
                """)) {
            bindItem(statement, item);
            statement.executeUpdate();
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to save sync queue item for entity " + item.entityType() + ':' + item.entityId(), error);
        }
    }

    public synchronized List<SyncQueueItem> findRecent(int limit) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                SELECT id, entity_type, entity_id, payload_json, sync_status, retry_count, last_error, created_at, last_attempt_at, synced_at
                FROM sync_queue
                ORDER BY created_at DESC, id DESC
                LIMIT ?
                """)) {
            statement.setInt(1, Math.max(1, limit));
            List<SyncQueueItem> items = new ArrayList<>();
            try (ResultSet resultSet = statement.executeQuery()) {
                while (resultSet.next()) {
                    items.add(mapRow(resultSet));
                }
            }
            return items;
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to load recent sync queue items", error);
        }
    }

    public synchronized Optional<SyncQueueItem> findByEntity(SyncEntityType entityType, String entityId) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                SELECT id, entity_type, entity_id, payload_json, sync_status, retry_count, last_error, created_at, last_attempt_at, synced_at
                FROM sync_queue
                WHERE entity_type = ? AND entity_id = ?
                LIMIT 1
                """)) {
            statement.setString(1, entityType.name());
            statement.setString(2, entityId);
            try (ResultSet resultSet = statement.executeQuery()) {
                if (!resultSet.next()) {
                    return Optional.empty();
                }
                return Optional.of(mapRow(resultSet));
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to load sync queue item for entity " + entityType + ':' + entityId, error);
        }
    }

    public synchronized List<SyncQueueItem> findRetryableItems(Instant now, int limit) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                SELECT id, entity_type, entity_id, payload_json, sync_status, retry_count, last_error, created_at, last_attempt_at, synced_at
                FROM sync_queue
                WHERE entity_type = ?
                  AND sync_status IN (?, ?, ?)
                ORDER BY created_at ASC, id ASC
                """)) {
            statement.setString(1, SyncEntityType.SESSION_SUMMARY.name());
            statement.setString(2, SyncStatus.PENDING.name());
            statement.setString(3, SyncStatus.RETRY_LATER.name());
            statement.setString(4, SyncStatus.SYNCING.name());

            List<SyncQueueItem> items = new ArrayList<>();
            try (ResultSet resultSet = statement.executeQuery()) {
                while (resultSet.next() && items.size() < Math.max(1, limit)) {
                    SyncQueueItem item = mapRow(resultSet);
                    if (isRetryable(item, now)) {
                        items.add(item);
                    }
                }
            }
            return items;
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to load retryable sync queue items", error);
        }
    }

    public synchronized List<SyncQueueItem> findFailedAndDeferred() {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                SELECT id, entity_type, entity_id, payload_json, sync_status, retry_count, last_error, created_at, last_attempt_at, synced_at
                FROM sync_queue
                WHERE sync_status IN (?, ?, ?)
                ORDER BY created_at DESC, id DESC
                """)) {
            statement.setString(1, SyncStatus.FAILED.name());
            statement.setString(2, SyncStatus.RETRY_LATER.name());
            statement.setString(3, SyncStatus.SKIPPED.name());
            List<SyncQueueItem> items = new ArrayList<>();
            try (ResultSet resultSet = statement.executeQuery()) {
                while (resultSet.next()) {
                    items.add(mapRow(resultSet));
                }
            }
            return items;
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to load failed and deferred sync queue items", error);
        }
    }

    public synchronized boolean markSyncing(String id, Instant attemptedAt) {
        return updateStatus(id, SyncStatus.SYNCING, null, attemptedAt, null);
    }

    public synchronized void markSynced(String id, Instant syncedAt) {
        updateStatus(id, SyncStatus.SYNCED, null, syncedAt, syncedAt);
    }

    public synchronized void markRetryLater(String id, int retryCount, String lastError, Instant attemptedAt) {
        updateFailure(id, SyncStatus.RETRY_LATER, retryCount, lastError, attemptedAt);
    }

    public synchronized void markFailed(String id, int retryCount, String lastError, Instant attemptedAt) {
        updateFailure(id, SyncStatus.FAILED, retryCount, lastError, attemptedAt);
    }

    public synchronized void markSkipped(String id, String reason, Instant attemptedAt) {
        updateFailure(id, SyncStatus.SKIPPED, 0, reason, attemptedAt);
    }

    private boolean updateStatus(
            String id,
            SyncStatus status,
            String lastError,
            Instant lastAttemptAt,
            Instant syncedAt
    ) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                UPDATE sync_queue
                SET sync_status = ?, last_error = ?, last_attempt_at = ?, synced_at = ?
                WHERE id = ?
                """)) {
            statement.setString(1, status.name());
            statement.setString(2, lastError);
            setNullableInstant(statement, 3, lastAttemptAt);
            setNullableInstant(statement, 4, syncedAt);
            statement.setString(5, id);
            return statement.executeUpdate() == 1;
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to mark sync queue item " + id + " as " + status, error);
        }
    }

    private void updateFailure(
            String id,
            SyncStatus status,
            int retryCount,
            String lastError,
            Instant attemptedAt
    ) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                UPDATE sync_queue
                SET sync_status = ?, retry_count = ?, last_error = ?, last_attempt_at = ?, synced_at = NULL
                WHERE id = ?
                """)) {
            statement.setString(1, status.name());
            statement.setInt(2, retryCount);
            statement.setString(3, abbreviate(lastError));
            statement.setString(4, attemptedAt.toString());
            statement.setString(5, id);
            statement.executeUpdate();
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to record sync failure for queue item " + id, error);
        }
    }

    private void bindItem(PreparedStatement statement, SyncQueueItem item) throws SQLException {
        statement.setString(1, item.id());
        statement.setString(2, item.entityType().name());
        statement.setString(3, item.entityId());
        statement.setString(4, item.payloadJson());
        statement.setString(5, item.syncStatus().name());
        statement.setInt(6, item.retryCount());
        statement.setString(7, item.lastError());
        statement.setString(8, item.createdAt().toString());
        setNullableInstant(statement, 9, item.lastAttemptAt());
        setNullableInstant(statement, 10, item.syncedAt());
    }

    private SyncQueueItem mapRow(ResultSet resultSet) throws SQLException {
        return new SyncQueueItem(
                resultSet.getString("id"),
                SyncEntityType.valueOf(resultSet.getString("entity_type")),
                resultSet.getString("entity_id"),
                resultSet.getString("payload_json"),
                SyncStatus.valueOf(resultSet.getString("sync_status")),
                resultSet.getInt("retry_count"),
                resultSet.getString("last_error"),
                parseInstant(resultSet.getString("created_at")),
                parseInstant(resultSet.getString("last_attempt_at")),
                parseInstant(resultSet.getString("synced_at"))
        );
    }

    private Connection openConnection() throws SQLException {
        return DriverManager.getConnection(jdbcUrl);
    }

    private static void setNullableInstant(PreparedStatement statement, int parameterIndex, Instant value) throws SQLException {
        if (value == null) {
            statement.setNull(parameterIndex, java.sql.Types.VARCHAR);
        } else {
            statement.setString(parameterIndex, value.toString());
        }
    }

    private static Instant parseInstant(String value) {
        return value == null ? null : Instant.parse(value);
    }

    private static boolean isRetryable(SyncQueueItem item, Instant now) {
        if (item.syncStatus() == SyncStatus.PENDING) {
            return true;
        }
        if (item.lastAttemptAt() == null) {
            return true;
        }
        long retryDelayMs = Math.min(15 * 60_000L, 30_000L * Math.max(1, item.retryCount()));
        return !item.lastAttemptAt().plusMillis(retryDelayMs).isAfter(now);
    }

    public synchronized Optional<SyncQueueItem> findById(String id) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                SELECT id, entity_type, entity_id, payload_json, sync_status, retry_count, last_error, created_at, last_attempt_at, synced_at
                FROM sync_queue
                WHERE id = ?
                LIMIT 1
                """)) {
            statement.setString(1, id);
            try (ResultSet resultSet = statement.executeQuery()) {
                if (!resultSet.next()) {
                    return Optional.empty();
                }
                return Optional.of(mapRow(resultSet));
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to load sync queue item " + id, error);
        }
    }

    public synchronized boolean requeue(String id) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                UPDATE sync_queue
                SET sync_status = ?, retry_count = 0, last_error = NULL, synced_at = NULL
                WHERE id = ? AND sync_status IN (?, ?, ?)
                """)) {
            statement.setString(1, SyncStatus.PENDING.name());
            statement.setString(2, id);
            statement.setString(3, SyncStatus.FAILED.name());
            statement.setString(4, SyncStatus.RETRY_LATER.name());
            statement.setString(5, SyncStatus.SKIPPED.name());
            return statement.executeUpdate() == 1;
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to requeue sync queue item " + id, error);
        }
    }

    public synchronized int requeueFailed() {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                UPDATE sync_queue
                SET sync_status = ?, retry_count = 0, last_error = NULL, synced_at = NULL
                WHERE sync_status IN (?, ?)
                """)) {
            statement.setString(1, SyncStatus.PENDING.name());
            statement.setString(2, SyncStatus.FAILED.name());
            statement.setString(3, SyncStatus.RETRY_LATER.name());
            return statement.executeUpdate();
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to requeue failed sync queue items", error);
        }
    }

    private static String abbreviate(String value) {
        if (value == null || value.length() <= 1_000) {
            return value;
        }
        return value.substring(0, 1_000);
    }
}
