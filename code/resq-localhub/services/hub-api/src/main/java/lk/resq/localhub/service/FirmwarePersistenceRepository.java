package lk.resq.localhub.service;

import lk.resq.localhub.model.firmware.FirmwareCalibrationResultRecord;
import lk.resq.localhub.model.firmware.FirmwareCommandRequestRecord;
import lk.resq.localhub.model.firmware.FirmwareDebugSnapshotRecord;
import lk.resq.localhub.model.firmware.FirmwareEventRecord;
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
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

@Repository
public class FirmwarePersistenceRepository {

    private static final Duration DEFAULT_COMMAND_TIMEOUT = Duration.ofMinutes(2);

    private final Path databasePath;
    private final String jdbcUrl;

    public FirmwarePersistenceRepository(@Value("${resq.storage.sqlite-path:${user.home}/.resq-localhub/hub-api.sqlite}") String sqlitePath) {
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
                        CREATE TABLE IF NOT EXISTS firmware_command_requests (
                          request_id TEXT PRIMARY KEY,
                          device_id TEXT NOT NULL,
                          command_type_id INTEGER NOT NULL,
                          command_name TEXT NOT NULL,
                          topic TEXT NOT NULL,
                          payload_json TEXT NOT NULL,
                          status TEXT NOT NULL,
                          reply_id TEXT,
                          reply_event_id INTEGER,
                          reply_status TEXT,
                          reply_payload_json TEXT,
                          reason_id TEXT,
                          action_id INTEGER,
                          created_at TEXT NOT NULL,
                          published_at TEXT,
                          completed_at TEXT,
                          timeout_at TEXT,
                          last_updated_at TEXT NOT NULL
                        )
                        """);
                statement.executeUpdate("""
                        CREATE TABLE IF NOT EXISTS firmware_events (
                          id INTEGER PRIMARY KEY AUTOINCREMENT,
                          device_id TEXT NOT NULL,
                          topic TEXT NOT NULL,
                          topic_family TEXT NOT NULL,
                          event_id INTEGER,
                          reply_id TEXT,
                          request_id TEXT,
                          status TEXT,
                          result TEXT,
                          reason_id TEXT,
                          action_id INTEGER,
                          progress_id INTEGER,
                          firmware_state TEXT,
                          session_id TEXT,
                          ts_ms INTEGER,
                          received_at TEXT NOT NULL,
                          payload_json TEXT NOT NULL
                        )
                        """);
                statement.executeUpdate("""
                        CREATE TABLE IF NOT EXISTS firmware_calibration_results (
                          id INTEGER PRIMARY KEY AUTOINCREMENT,
                          device_id TEXT NOT NULL,
                          profile_id TEXT,
                          request_id TEXT,
                          reply_id TEXT,
                          event_id INTEGER,
                          result TEXT,
                          status TEXT,
                          progress_id INTEGER,
                          reason_id TEXT,
                          action_id INTEGER,
                          firmware_state TEXT,
                          calibrated INTEGER,
                          ts_ms INTEGER,
                          received_at TEXT NOT NULL,
                          payload_json TEXT NOT NULL
                        )
                        """);
                statement.executeUpdate("""
                        CREATE TABLE IF NOT EXISTS firmware_debug_snapshots (
                          id INTEGER PRIMARY KEY AUTOINCREMENT,
                          device_id TEXT NOT NULL,
                          request_id TEXT,
                          pressure_0_raw INTEGER,
                          pressure_1_raw INTEGER,
                          pressure_2_raw INTEGER,
                          hall_raw INTEGER,
                          ts_ms INTEGER,
                          received_at TEXT NOT NULL,
                          payload_json TEXT NOT NULL
                        )
                        """);
                statement.executeUpdate("CREATE INDEX IF NOT EXISTS idx_firmware_command_requests_device_created ON firmware_command_requests(device_id, created_at DESC)");
                statement.executeUpdate("CREATE INDEX IF NOT EXISTS idx_firmware_events_device_received ON firmware_events(device_id, received_at DESC)");
                statement.executeUpdate("CREATE INDEX IF NOT EXISTS idx_firmware_calibration_device_received ON firmware_calibration_results(device_id, received_at DESC)");
                statement.executeUpdate("CREATE INDEX IF NOT EXISTS idx_firmware_debug_device_received ON firmware_debug_snapshots(device_id, received_at DESC)");
            }
        } catch (IOException | SQLException error) {
            throw new IllegalStateException("Failed to initialize firmware persistence store at " + databasePath, error);
        }
    }

    public synchronized void recordCommandRequest(FirmwareCommandRequestRecord request) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO firmware_command_requests (
                  request_id, device_id, command_type_id, command_name, topic, payload_json, status,
                  reply_id, reply_event_id, reply_status, reply_payload_json, reason_id, action_id,
                  created_at, published_at, completed_at, timeout_at, last_updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(request_id) DO UPDATE SET
                  device_id = excluded.device_id,
                  command_type_id = excluded.command_type_id,
                  command_name = excluded.command_name,
                  topic = excluded.topic,
                  payload_json = excluded.payload_json,
                  status = excluded.status,
                  reply_id = excluded.reply_id,
                  reply_event_id = excluded.reply_event_id,
                  reply_status = excluded.reply_status,
                  reply_payload_json = excluded.reply_payload_json,
                  reason_id = excluded.reason_id,
                  action_id = excluded.action_id,
                  created_at = excluded.created_at,
                  published_at = excluded.published_at,
                  completed_at = excluded.completed_at,
                  timeout_at = excluded.timeout_at,
                  last_updated_at = excluded.last_updated_at
                """)) {
            bindCommandRequest(statement, request);
            statement.executeUpdate();
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to record firmware command request " + request.requestId(), error);
        }
    }

    public synchronized boolean markCommandPublished(String requestId, Instant publishedAt) {
        return updateCommandState(requestId, "PUBLISHED", publishedAt, null, null, null, null, null);
    }

    public synchronized boolean markCommandFailed(String requestId, Instant updatedAt, String failureReason) {
        return updateCommandState(requestId, "FAILED", updatedAt, null, null, null, failureReason, null);
    }

    public synchronized boolean updateCommandFromReply(
            String replyId,
            Integer replyEventId,
            String replyStatus,
            String replyPayloadJson,
            String reasonId,
            Integer actionId,
            Instant completedAt
    ) {
        String updatedStatus = determineCommandStatus(replyEventId, replyStatus);

        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                UPDATE firmware_command_requests
                SET reply_id = ?,
                    reply_event_id = ?,
                    reply_status = ?,
                    reply_payload_json = ?,
                    reason_id = ?,
                    action_id = ?,
                    completed_at = ?,
                    status = ?,
                    last_updated_at = ?
                WHERE request_id = ? OR reply_id = ?
                """)) {
            statement.setString(1, replyId);
            setNullableInteger(statement, 2, replyEventId);
            statement.setString(3, replyStatus);
            statement.setString(4, replyPayloadJson);
            statement.setString(5, reasonId);
            setNullableInteger(statement, 6, actionId);
            statement.setString(7, toIso(completedAt));
            statement.setString(8, updatedStatus);
            statement.setString(9, toIso(completedAt));
            statement.setString(10, replyId);
            statement.setString(11, replyId);
            return statement.executeUpdate() > 0;
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to update firmware command request from reply " + replyId, error);
        }
    }

    public synchronized Optional<FirmwareCommandRequestRecord> findCommandByRequestId(String requestId) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                SELECT request_id, device_id, command_type_id, command_name, topic, payload_json, status,
                       reply_id, reply_event_id, reply_status, reply_payload_json, reason_id, action_id,
                       created_at, published_at, completed_at, timeout_at, last_updated_at
                FROM firmware_command_requests
                WHERE request_id = ?
                LIMIT 1
                """)) {
            statement.setString(1, requestId);
            try (ResultSet resultSet = statement.executeQuery()) {
                if (!resultSet.next()) {
                    return Optional.empty();
                }
                return Optional.of(mapCommand(resultSet));
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to load firmware command request " + requestId, error);
        }
    }

    public synchronized List<FirmwareCommandRequestRecord> findRecentCommands(String deviceId, int limit) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                SELECT request_id, device_id, command_type_id, command_name, topic, payload_json, status,
                       reply_id, reply_event_id, reply_status, reply_payload_json, reason_id, action_id,
                       created_at, published_at, completed_at, timeout_at, last_updated_at
                FROM firmware_command_requests
                WHERE device_id = ?
                ORDER BY last_updated_at DESC, created_at DESC
                LIMIT ?
                """)) {
            statement.setString(1, deviceId);
            statement.setInt(2, Math.max(1, limit));
            List<FirmwareCommandRequestRecord> commands = new ArrayList<>();
            try (ResultSet resultSet = statement.executeQuery()) {
                while (resultSet.next()) {
                    commands.add(mapCommand(resultSet));
                }
            }
            return commands;
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to load recent firmware command requests for device " + deviceId, error);
        }
    }

    public synchronized void saveFirmwareEvent(FirmwareEventRecord event) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO firmware_events (
                  device_id, topic, topic_family, event_id, reply_id, request_id, status, result, reason_id,
                  action_id, progress_id, firmware_state, session_id, ts_ms, received_at, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """)) {
            bindFirmwareEvent(statement, event);
            statement.executeUpdate();
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to persist firmware event for device " + event.deviceId(), error);
        }
    }

    public synchronized List<FirmwareEventRecord> findRecentEvents(String deviceId, int limit) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                SELECT id, device_id, topic, topic_family, event_id, reply_id, request_id, status, result, reason_id,
                       action_id, progress_id, firmware_state, session_id, ts_ms, received_at, payload_json
                FROM firmware_events
                WHERE device_id = ?
                ORDER BY received_at DESC, id DESC
                LIMIT ?
                """)) {
            statement.setString(1, deviceId);
            statement.setInt(2, Math.max(1, limit));
            List<FirmwareEventRecord> events = new ArrayList<>();
            try (ResultSet resultSet = statement.executeQuery()) {
                while (resultSet.next()) {
                    events.add(mapEvent(resultSet));
                }
            }
            return events;
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to load recent firmware events for device " + deviceId, error);
        }
    }

    public synchronized void saveCalibrationResult(FirmwareCalibrationResultRecord result) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO firmware_calibration_results (
                  device_id, profile_id, request_id, reply_id, event_id, result, status, progress_id, reason_id,
                  action_id, firmware_state, calibrated, ts_ms, received_at, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """)) {
            bindCalibrationResult(statement, result);
            statement.executeUpdate();
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to persist firmware calibration result for device " + result.deviceId(), error);
        }
    }

    public synchronized Optional<FirmwareCalibrationResultRecord> findLatestCalibrationResult(String deviceId) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                SELECT id, device_id, profile_id, request_id, reply_id, event_id, result, status, progress_id,
                       reason_id, action_id, firmware_state, calibrated, ts_ms, received_at, payload_json
                FROM firmware_calibration_results
                WHERE device_id = ?
                ORDER BY CASE WHEN result IS NULL THEN 1 ELSE 0 END, received_at DESC, id DESC
                LIMIT 1
                """)) {
            statement.setString(1, deviceId);
            try (ResultSet resultSet = statement.executeQuery()) {
                if (!resultSet.next()) {
                    return Optional.empty();
                }
                return Optional.of(mapCalibration(resultSet));
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to load latest firmware calibration result for device " + deviceId, error);
        }
    }

    public synchronized void saveDebugSnapshot(FirmwareDebugSnapshotRecord snapshot) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO firmware_debug_snapshots (
                  device_id, request_id, pressure_0_raw, pressure_1_raw, pressure_2_raw, hall_raw, ts_ms, received_at, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """)) {
            bindDebugSnapshot(statement, snapshot);
            statement.executeUpdate();
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to persist firmware debug snapshot for device " + snapshot.deviceId(), error);
        }
    }

    public synchronized List<FirmwareDebugSnapshotRecord> findDebugSnapshots(String deviceId, int limit) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                SELECT id, device_id, request_id, pressure_0_raw, pressure_1_raw, pressure_2_raw, hall_raw, ts_ms, received_at, payload_json
                FROM firmware_debug_snapshots
                WHERE device_id = ?
                ORDER BY received_at DESC, id DESC
                LIMIT ?
                """)) {
            statement.setString(1, deviceId);
            statement.setInt(2, Math.max(1, limit));
            List<FirmwareDebugSnapshotRecord> snapshots = new ArrayList<>();
            try (ResultSet resultSet = statement.executeQuery()) {
                while (resultSet.next()) {
                    snapshots.add(mapDebugSnapshot(resultSet));
                }
            }
            return snapshots;
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to load recent firmware debug snapshots for device " + deviceId, error);
        }
    }

    private boolean updateCommandState(
            String requestId,
            String status,
            Instant updatedAt,
            String replyId,
            Integer replyEventId,
            String replyStatus,
            String replyPayloadJson,
            String reasonId
    ) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                UPDATE firmware_command_requests
                SET status = ?,
                    published_at = CASE WHEN ? = 'PUBLISHED' THEN ? ELSE published_at END,
                    reply_id = COALESCE(?, reply_id),
                    reply_event_id = COALESCE(?, reply_event_id),
                    reply_status = COALESCE(?, reply_status),
                    reply_payload_json = COALESCE(?, reply_payload_json),
                    reason_id = COALESCE(?, reason_id),
                    completed_at = CASE WHEN ? IN ('ACK', 'NACK', 'FINAL', 'TIMEOUT', 'FAILED') THEN ? ELSE completed_at END,
                    last_updated_at = ?
                WHERE request_id = ?
                """)) {
            statement.setString(1, status);
            statement.setString(2, status);
            statement.setString(3, toIso(updatedAt));
            statement.setString(4, replyId);
            setNullableInteger(statement, 5, replyEventId);
            statement.setString(6, replyStatus);
            statement.setString(7, replyPayloadJson);
            statement.setString(8, reasonId);
            statement.setString(9, status);
            statement.setString(10, toIso(updatedAt));
            statement.setString(11, toIso(updatedAt));
            statement.setString(12, requestId);
            return statement.executeUpdate() > 0;
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to update firmware command request " + requestId + " to status " + status, error);
        }
    }

    private String determineCommandStatus(Integer replyEventId, String replyStatus) {
        if (replyStatus != null) {
            String normalized = replyStatus.trim().toUpperCase();
            if ("NACK".equals(normalized)) {
                return "NACK";
            }
            if ("ACK".equals(normalized)) {
                return "ACK";
            }
            if ("FINAL".equals(normalized)) {
                return "FINAL";
            }
        }

        if (replyEventId != null) {
            if (replyEventId == 4002 || replyEventId == 2001 || replyEventId == 2002 || replyEventId == 5002) {
                return "FINAL";
            }
            return "ACK";
        }

        return "PUBLISHED";
    }

    private void bindCommandRequest(PreparedStatement statement, FirmwareCommandRequestRecord request) throws SQLException {
        statement.setString(1, request.requestId());
        statement.setString(2, request.deviceId());
        statement.setInt(3, request.commandTypeId());
        statement.setString(4, request.commandName());
        statement.setString(5, request.topic());
        statement.setString(6, request.payloadJson());
        statement.setString(7, request.status());
        statement.setString(8, request.replyId());
        setNullableInteger(statement, 9, request.replyEventId());
        statement.setString(10, request.replyStatus());
        statement.setString(11, request.replyPayloadJson());
        statement.setString(12, request.reasonId());
        setNullableInteger(statement, 13, request.actionId());
        statement.setString(14, toIso(request.createdAt()));
        statement.setString(15, toIso(request.publishedAt()));
        statement.setString(16, toIso(request.completedAt()));
        statement.setString(17, toIso(request.timeoutAt()));
        statement.setString(18, toIso(request.lastUpdatedAt()));
    }

    private void bindFirmwareEvent(PreparedStatement statement, FirmwareEventRecord event) throws SQLException {
        statement.setString(1, event.deviceId());
        statement.setString(2, event.topic());
        statement.setString(3, event.topicFamily());
        setNullableInteger(statement, 4, event.eventId());
        statement.setString(5, event.replyId());
        statement.setString(6, event.requestId());
        statement.setString(7, event.status());
        statement.setString(8, event.result());
        statement.setString(9, event.reasonId());
        setNullableInteger(statement, 10, event.actionId());
        setNullableInteger(statement, 11, event.progressId());
        statement.setString(12, event.firmwareState());
        statement.setString(13, event.sessionId());
        setNullableLong(statement, 14, event.tsMs());
        statement.setString(15, toIso(event.receivedAt()));
        statement.setString(16, event.payloadJson());
    }

    private void bindCalibrationResult(PreparedStatement statement, FirmwareCalibrationResultRecord result) throws SQLException {
        statement.setString(1, result.deviceId());
        statement.setString(2, result.profileId());
        statement.setString(3, result.requestId());
        statement.setString(4, result.replyId());
        setNullableInteger(statement, 5, result.eventId());
        statement.setString(6, result.result());
        statement.setString(7, result.status());
        setNullableInteger(statement, 8, result.progressId());
        statement.setString(9, result.reasonId());
        setNullableInteger(statement, 10, result.actionId());
        statement.setString(11, result.firmwareState());
        if (result.calibrated() == null) {
            statement.setObject(12, null);
        } else {
            statement.setInt(12, result.calibrated() ? 1 : 0);
        }
        setNullableLong(statement, 13, result.tsMs());
        statement.setString(14, toIso(result.receivedAt()));
        statement.setString(15, result.payloadJson());
    }

    private void bindDebugSnapshot(PreparedStatement statement, FirmwareDebugSnapshotRecord snapshot) throws SQLException {
        statement.setString(1, snapshot.deviceId());
        statement.setString(2, snapshot.requestId());
        setNullableInteger(statement, 3, snapshot.pressure0Raw());
        setNullableInteger(statement, 4, snapshot.pressure1Raw());
        setNullableInteger(statement, 5, snapshot.pressure2Raw());
        setNullableInteger(statement, 6, snapshot.hallRaw());
        setNullableLong(statement, 7, snapshot.tsMs());
        statement.setString(8, toIso(snapshot.receivedAt()));
        statement.setString(9, snapshot.payloadJson());
    }

    private FirmwareCommandRequestRecord mapCommand(ResultSet resultSet) throws SQLException {
        return new FirmwareCommandRequestRecord(
                resultSet.getString("request_id"),
                resultSet.getString("device_id"),
                resultSet.getInt("command_type_id"),
                resultSet.getString("command_name"),
                resultSet.getString("topic"),
                resultSet.getString("payload_json"),
                resultSet.getString("status"),
                resultSet.getString("reply_id"),
                getNullableInteger(resultSet, "reply_event_id"),
                resultSet.getString("reply_status"),
                resultSet.getString("reply_payload_json"),
                resultSet.getString("reason_id"),
                getNullableInteger(resultSet, "action_id"),
                parseInstant(resultSet.getString("created_at")),
                parseInstant(resultSet.getString("published_at")),
                parseInstant(resultSet.getString("completed_at")),
                parseInstant(resultSet.getString("timeout_at")),
                parseInstant(resultSet.getString("last_updated_at"))
        );
    }

    private FirmwareEventRecord mapEvent(ResultSet resultSet) throws SQLException {
        return new FirmwareEventRecord(
                resultSet.getLong("id"),
                resultSet.getString("device_id"),
                resultSet.getString("topic"),
                resultSet.getString("topic_family"),
                getNullableInteger(resultSet, "event_id"),
                resultSet.getString("reply_id"),
                resultSet.getString("request_id"),
                resultSet.getString("status"),
                resultSet.getString("result"),
                resultSet.getString("reason_id"),
                getNullableInteger(resultSet, "action_id"),
                getNullableInteger(resultSet, "progress_id"),
                resultSet.getString("firmware_state"),
                resultSet.getString("session_id"),
                getNullableLong(resultSet, "ts_ms"),
                parseInstant(resultSet.getString("received_at")),
                resultSet.getString("payload_json")
        );
    }

    private FirmwareCalibrationResultRecord mapCalibration(ResultSet resultSet) throws SQLException {
        return new FirmwareCalibrationResultRecord(
                resultSet.getLong("id"),
                resultSet.getString("device_id"),
                resultSet.getString("profile_id"),
                resultSet.getString("request_id"),
                resultSet.getString("reply_id"),
                getNullableInteger(resultSet, "event_id"),
                resultSet.getString("result"),
                resultSet.getString("status"),
                getNullableInteger(resultSet, "progress_id"),
                resultSet.getString("reason_id"),
                getNullableInteger(resultSet, "action_id"),
                resultSet.getString("firmware_state"),
                getNullableInteger(resultSet, "calibrated") == null ? null : getNullableInteger(resultSet, "calibrated") == 1,
                getNullableLong(resultSet, "ts_ms"),
                parseInstant(resultSet.getString("received_at")),
                resultSet.getString("payload_json")
        );
    }

    private FirmwareDebugSnapshotRecord mapDebugSnapshot(ResultSet resultSet) throws SQLException {
        return new FirmwareDebugSnapshotRecord(
                resultSet.getLong("id"),
                resultSet.getString("device_id"),
                resultSet.getString("request_id"),
                getNullableInteger(resultSet, "pressure_0_raw"),
                getNullableInteger(resultSet, "pressure_1_raw"),
                getNullableInteger(resultSet, "pressure_2_raw"),
                getNullableInteger(resultSet, "hall_raw"),
                getNullableLong(resultSet, "ts_ms"),
                parseInstant(resultSet.getString("received_at")),
                resultSet.getString("payload_json")
        );
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