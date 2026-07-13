package lk.resq.localhub.service;

import lk.resq.localhub.model.DurableSessionRuntimeRecord;
import lk.resq.localhub.model.SessionLifecycleState;
import lk.resq.localhub.model.SessionRecoveryStatus;
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
public class SessionRuntimeRepository {

    private final Path databasePath;
    private final String jdbcUrl;

    public SessionRuntimeRepository(@Value("${resq.storage.sqlite-path:${user.home}/.resq-localhub/hub-api.sqlite}") String sqlitePath) {
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
                        CREATE TABLE IF NOT EXISTS session_runtime (
                          session_id TEXT PRIMARY KEY,
                          device_id TEXT NOT NULL,
                          trainee_id TEXT,
                          profile_id TEXT,
                          scenario TEXT,
                          notes TEXT,
                          course_id TEXT,
                          instructor_id TEXT,
                          lifecycle_state TEXT NOT NULL,
                          active INTEGER NOT NULL DEFAULT 0,
                          started_at TEXT NOT NULL,
                          updated_at TEXT NOT NULL,
                          ended_at TEXT,
                          start_request_id TEXT,
                          start_requested_at TEXT,
                          start_deadline TEXT,
                          stop_request_id TEXT,
                          stop_requested_at TEXT,
                          stop_deadline TEXT,
                          rejection_reason TEXT,
                          firmware_reason_id TEXT,
                          firmware_action_id INTEGER,
                          last_accepted_telemetry_seq INTEGER,
                          accumulator_snapshot_json TEXT,
                          completed_persisted INTEGER NOT NULL DEFAULT 0,
                          sync_queued INTEGER NOT NULL DEFAULT 0,
                          recovery_status TEXT NOT NULL DEFAULT 'NONE',
                          recovery_started_at TEXT,
                          recovery_deadline TEXT,
                          recovery_reason TEXT
                        )
                        """);
                statement.executeUpdate("CREATE INDEX IF NOT EXISTS idx_session_runtime_device_id ON session_runtime(device_id)");
                statement.executeUpdate("CREATE INDEX IF NOT EXISTS idx_session_runtime_lifecycle_state ON session_runtime(lifecycle_state)");
                statement.executeUpdate("CREATE INDEX IF NOT EXISTS idx_session_runtime_start_request_id ON session_runtime(start_request_id)");
                statement.executeUpdate("CREATE INDEX IF NOT EXISTS idx_session_runtime_stop_request_id ON session_runtime(stop_request_id)");
                statement.executeUpdate("CREATE INDEX IF NOT EXISTS idx_session_runtime_updated_at ON session_runtime(updated_at)");
                statement.executeUpdate("CREATE UNIQUE INDEX IF NOT EXISTS idx_session_runtime_start_request_unique ON session_runtime(start_request_id) WHERE start_request_id IS NOT NULL");
                statement.executeUpdate("CREATE UNIQUE INDEX IF NOT EXISTS idx_session_runtime_stop_request_unique ON session_runtime(stop_request_id) WHERE stop_request_id IS NOT NULL");
            }
        } catch (IOException | SQLException error) {
            throw new IllegalStateException("Failed to initialize session runtime store at " + databasePath, error);
        }
    }

    public synchronized void upsert(DurableSessionRuntimeRecord record) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO session_runtime (
                  session_id, device_id, trainee_id, profile_id, scenario, notes, course_id, instructor_id,
                  lifecycle_state, active, started_at, updated_at, ended_at, start_request_id, start_requested_at,
                  start_deadline, stop_request_id, stop_requested_at, stop_deadline, rejection_reason,
                  firmware_reason_id, firmware_action_id, last_accepted_telemetry_seq, accumulator_snapshot_json,
                  completed_persisted, sync_queued, recovery_status, recovery_started_at, recovery_deadline, recovery_reason
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                  device_id = excluded.device_id,
                  trainee_id = excluded.trainee_id,
                  profile_id = excluded.profile_id,
                  scenario = excluded.scenario,
                  notes = excluded.notes,
                  course_id = excluded.course_id,
                  instructor_id = excluded.instructor_id,
                  lifecycle_state = excluded.lifecycle_state,
                  active = excluded.active,
                  started_at = excluded.started_at,
                  updated_at = excluded.updated_at,
                  ended_at = excluded.ended_at,
                  start_request_id = excluded.start_request_id,
                  start_requested_at = excluded.start_requested_at,
                  start_deadline = excluded.start_deadline,
                  stop_request_id = excluded.stop_request_id,
                  stop_requested_at = excluded.stop_requested_at,
                  stop_deadline = excluded.stop_deadline,
                  rejection_reason = excluded.rejection_reason,
                  firmware_reason_id = excluded.firmware_reason_id,
                  firmware_action_id = excluded.firmware_action_id,
                  last_accepted_telemetry_seq = excluded.last_accepted_telemetry_seq,
                  accumulator_snapshot_json = excluded.accumulator_snapshot_json,
                  completed_persisted = excluded.completed_persisted,
                  sync_queued = excluded.sync_queued,
                  recovery_status = excluded.recovery_status,
                  recovery_started_at = excluded.recovery_started_at,
                  recovery_deadline = excluded.recovery_deadline,
                  recovery_reason = excluded.recovery_reason
                """)) {
            bind(statement, record);
            statement.executeUpdate();
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to persist session runtime " + record.sessionId(), error);
        }
    }

    public synchronized Optional<DurableSessionRuntimeRecord> findBySessionId(String sessionId) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement(selectSql() + " WHERE session_id = ? LIMIT 1")) {
            statement.setString(1, sessionId);
            try (ResultSet resultSet = statement.executeQuery()) {
                return resultSet.next() ? Optional.of(mapRow(resultSet)) : Optional.empty();
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to load session runtime " + sessionId, error);
        }
    }

    public synchronized List<DurableSessionRuntimeRecord> findByDeviceId(String deviceId) {
        return findList(" WHERE device_id = ? ORDER BY updated_at DESC", deviceId);
    }

    public synchronized List<DurableSessionRuntimeRecord> findRecoverable() {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement(selectSql() + """
                WHERE lifecycle_state IN (?, ?, ?, ?, ?, ?, ?)
                ORDER BY updated_at DESC
                """)) {
            String[] states = {
                    SessionLifecycleState.START_PENDING.name(),
                    SessionLifecycleState.ACTIVE.name(),
                    SessionLifecycleState.STOP_PENDING.name(),
                    SessionLifecycleState.STOP_REJECTED.name(),
                    SessionLifecycleState.START_TIMEOUT.name(),
                    SessionLifecycleState.STOP_TIMEOUT.name(),
                    SessionLifecycleState.INTERRUPTED.name()
            };
            for (int i = 0; i < states.length; i++) {
                statement.setString(i + 1, states[i]);
            }
            List<DurableSessionRuntimeRecord> records = new ArrayList<>();
            try (ResultSet resultSet = statement.executeQuery()) {
                while (resultSet.next()) {
                    records.add(mapRow(resultSet));
                }
            }
            return records;
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to load recoverable session runtimes", error);
        }
    }

    public synchronized void markTerminal(String sessionId, SessionLifecycleState state, String reason, Instant updatedAt) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                UPDATE session_runtime
                SET lifecycle_state = ?, active = 0, rejection_reason = ?, updated_at = ?, recovery_status = ?
                WHERE session_id = ?
                """)) {
            statement.setString(1, state.name());
            statement.setString(2, reason);
            statement.setString(3, toIso(updatedAt));
            statement.setString(4, SessionRecoveryStatus.NONE.name());
            statement.setString(5, sessionId);
            statement.executeUpdate();
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to mark session runtime terminal " + sessionId, error);
        }
    }

    public synchronized void deleteOrArchive(String sessionId) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("DELETE FROM session_runtime WHERE session_id = ?")) {
            statement.setString(1, sessionId);
            statement.executeUpdate();
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to delete session runtime " + sessionId, error);
        }
    }

    private List<DurableSessionRuntimeRecord> findList(String where, String value) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement(selectSql() + where)) {
            statement.setString(1, value);
            List<DurableSessionRuntimeRecord> records = new ArrayList<>();
            try (ResultSet resultSet = statement.executeQuery()) {
                while (resultSet.next()) {
                    records.add(mapRow(resultSet));
                }
            }
            return records;
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to load session runtime records", error);
        }
    }

    private void bind(PreparedStatement statement, DurableSessionRuntimeRecord record) throws SQLException {
        statement.setString(1, record.sessionId());
        statement.setString(2, record.deviceId());
        statement.setString(3, record.traineeId());
        statement.setString(4, record.profileId());
        statement.setString(5, record.scenario());
        statement.setString(6, record.notes());
        statement.setString(7, record.courseId());
        statement.setString(8, record.instructorId());
        statement.setString(9, record.lifecycleState().name());
        statement.setInt(10, record.active() ? 1 : 0);
        statement.setString(11, toIso(record.startedAt()));
        statement.setString(12, toIso(record.updatedAt()));
        statement.setString(13, toIso(record.endedAt()));
        statement.setString(14, record.startRequestId());
        statement.setString(15, toIso(record.startRequestedAt()));
        statement.setString(16, toIso(record.startDeadline()));
        statement.setString(17, record.stopRequestId());
        statement.setString(18, toIso(record.stopRequestedAt()));
        statement.setString(19, toIso(record.stopDeadline()));
        statement.setString(20, record.rejectionReason());
        statement.setString(21, record.firmwareReasonId());
        setNullableInteger(statement, 22, record.firmwareActionId());
        setNullableLong(statement, 23, record.lastAcceptedTelemetrySeq());
        statement.setString(24, record.accumulatorSnapshotJson());
        statement.setInt(25, record.completedPersisted() ? 1 : 0);
        statement.setInt(26, record.syncQueued() ? 1 : 0);
        statement.setString(27, (record.recoveryStatus() == null ? SessionRecoveryStatus.NONE : record.recoveryStatus()).name());
        statement.setString(28, toIso(record.recoveryStartedAt()));
        statement.setString(29, toIso(record.recoveryDeadline()));
        statement.setString(30, record.recoveryReason());
    }

    private DurableSessionRuntimeRecord mapRow(ResultSet resultSet) throws SQLException {
        return new DurableSessionRuntimeRecord(
                resultSet.getString("session_id"),
                resultSet.getString("device_id"),
                resultSet.getString("trainee_id"),
                resultSet.getString("profile_id"),
                resultSet.getString("scenario"),
                resultSet.getString("notes"),
                resultSet.getString("course_id"),
                resultSet.getString("instructor_id"),
                SessionLifecycleState.valueOf(resultSet.getString("lifecycle_state")),
                resultSet.getInt("active") == 1,
                parseInstant(resultSet.getString("started_at")),
                parseInstant(resultSet.getString("updated_at")),
                parseInstant(resultSet.getString("ended_at")),
                resultSet.getString("start_request_id"),
                parseInstant(resultSet.getString("start_requested_at")),
                parseInstant(resultSet.getString("start_deadline")),
                resultSet.getString("stop_request_id"),
                parseInstant(resultSet.getString("stop_requested_at")),
                parseInstant(resultSet.getString("stop_deadline")),
                resultSet.getString("rejection_reason"),
                resultSet.getString("firmware_reason_id"),
                getNullableInteger(resultSet, "firmware_action_id"),
                getNullableLong(resultSet, "last_accepted_telemetry_seq"),
                resultSet.getString("accumulator_snapshot_json"),
                resultSet.getInt("completed_persisted") == 1,
                resultSet.getInt("sync_queued") == 1,
                SessionRecoveryStatus.valueOf(resultSet.getString("recovery_status")),
                parseInstant(resultSet.getString("recovery_started_at")),
                parseInstant(resultSet.getString("recovery_deadline")),
                resultSet.getString("recovery_reason")
        );
    }

    private static String selectSql() {
        return """
                SELECT session_id, device_id, trainee_id, profile_id, scenario, notes, course_id, instructor_id,
                       lifecycle_state, active, started_at, updated_at, ended_at, start_request_id, start_requested_at,
                       start_deadline, stop_request_id, stop_requested_at, stop_deadline, rejection_reason,
                       firmware_reason_id, firmware_action_id, last_accepted_telemetry_seq, accumulator_snapshot_json,
                       completed_persisted, sync_queued, recovery_status, recovery_started_at, recovery_deadline,
                       recovery_reason
                FROM session_runtime
                """;
    }

    private Connection openConnection() throws SQLException {
        return DriverManager.getConnection(jdbcUrl);
    }

    private static void setNullableInteger(PreparedStatement statement, int index, Integer value) throws SQLException {
        if (value == null) {
            statement.setObject(index, null);
        } else {
            statement.setInt(index, value);
        }
    }

    private static void setNullableLong(PreparedStatement statement, int index, Long value) throws SQLException {
        if (value == null) {
            statement.setObject(index, null);
        } else {
            statement.setLong(index, value);
        }
    }

    private static Integer getNullableInteger(ResultSet resultSet, String column) throws SQLException {
        int value = resultSet.getInt(column);
        return resultSet.wasNull() ? null : value;
    }

    private static Long getNullableLong(ResultSet resultSet, String column) throws SQLException {
        long value = resultSet.getLong(column);
        return resultSet.wasNull() ? null : value;
    }

    private static String toIso(Instant instant) {
        return instant == null ? null : instant.toString();
    }

    private static Instant parseInstant(String value) {
        return value == null ? null : Instant.parse(value);
    }
}
