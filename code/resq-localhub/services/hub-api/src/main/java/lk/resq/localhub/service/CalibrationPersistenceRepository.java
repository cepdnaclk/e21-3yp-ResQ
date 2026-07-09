package lk.resq.localhub.service;

import lk.resq.localhub.model.firmware.CalibrationEvidence;
import lk.resq.localhub.model.firmware.CalibrationEventLog;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Repository;

import jakarta.annotation.PostConstruct;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.*;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

@Repository
public class CalibrationPersistenceRepository {

    private static final int MAX_RAW_PAYLOAD_CHARS = 4096;

    private final Path databasePath;
    private final String jdbcUrl;

    public CalibrationPersistenceRepository(@Value("${resq.storage.sqlite-path:${user.home}/.resq-localhub/hub-api.sqlite}") String sqlitePath) {
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
                        CREATE TABLE IF NOT EXISTS calibration_evidences (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            device_id TEXT NOT NULL,
                            request_id TEXT NOT NULL,
                            started_at TEXT NOT NULL,
                            completed_at TEXT,
                            final_result TEXT,
                            calibration_state TEXT,
                            ready_for_session_at_completion INTEGER,
                            last_progress_id INTEGER,
                            last_reason_id TEXT,
                            last_action_id INTEGER,
                            firmware_state TEXT,
                            profile_id TEXT,
                            hall_delta INTEGER,
                            ref_pressure INTEGER,
                            bladder1_pressure INTEGER,
                            bladder2_pressure INTEGER,
                            sample_interval_ms INTEGER,
                            calibration_window_ms INTEGER,
                            created_by_username TEXT,
                            created_at TEXT NOT NULL,
                            updated_at TEXT NOT NULL
                        )
                        """);
                statement.executeUpdate("""
                        CREATE TABLE IF NOT EXISTS calibration_event_logs (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            device_id TEXT NOT NULL,
                            request_id TEXT,
                            event_id INTEGER,
                            progress_id INTEGER,
                            result TEXT,
                            status TEXT,
                            reason_id TEXT,
                            action_id INTEGER,
                            firmware_state TEXT,
                            ts_ms INTEGER,
                            received_at TEXT NOT NULL,
                            raw_payload_json TEXT
                        )
                        """);
                statement.executeUpdate("CREATE INDEX IF NOT EXISTS idx_cal_evidences_device_started ON calibration_evidences(device_id, started_at DESC)");
                statement.executeUpdate("CREATE INDEX IF NOT EXISTS idx_cal_evidences_request ON calibration_evidences(request_id)");
                statement.executeUpdate("CREATE INDEX IF NOT EXISTS idx_cal_event_logs_device_received ON calibration_event_logs(device_id, received_at DESC)");
                statement.executeUpdate("CREATE INDEX IF NOT EXISTS idx_cal_event_logs_request ON calibration_event_logs(request_id)");
            }
        } catch (IOException | SQLException error) {
            throw new IllegalStateException("Failed to initialize calibration persistence store at " + databasePath, error);
        }
    }

    public synchronized void saveEvidence(CalibrationEvidence evidence) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO calibration_evidences (
                    device_id, request_id, started_at, completed_at, final_result, calibration_state,
                    ready_for_session_at_completion, last_progress_id, last_reason_id, last_action_id,
                    firmware_state, profile_id, hall_delta, ref_pressure, bladder1_pressure, bladder2_pressure,
                    sample_interval_ms, calibration_window_ms, created_by_username, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """)) {
            statement.setString(1, evidence.deviceId());
            statement.setString(2, evidence.requestId());
            statement.setString(3, toIso(evidence.startedAt()));
            statement.setString(4, toIso(evidence.completedAt()));
            statement.setString(5, evidence.finalResult());
            statement.setString(6, evidence.calibrationState());
            setNullableBoolean(statement, 7, evidence.readyForSessionAtCompletion());
            setNullableInteger(statement, 8, evidence.lastProgressId());
            statement.setString(9, evidence.lastReasonId());
            setNullableInteger(statement, 10, evidence.lastActionId());
            statement.setString(11, evidence.firmwareState());
            statement.setString(12, evidence.profileId());
            setNullableInteger(statement, 13, evidence.hallDelta());
            setNullableInteger(statement, 14, evidence.refPressure());
            setNullableInteger(statement, 15, evidence.bladder1Pressure());
            setNullableInteger(statement, 16, evidence.bladder2Pressure());
            setNullableInteger(statement, 17, evidence.sampleIntervalMs());
            setNullableInteger(statement, 18, evidence.calibrationWindowMs());
            statement.setString(19, evidence.createdByUsername());
            statement.setString(20, toIso(evidence.createdAt()));
            statement.setString(21, toIso(evidence.updatedAt()));
            statement.executeUpdate();
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to save calibration evidence for device " + evidence.deviceId(), error);
        }
    }

    public synchronized void updateEvidence(CalibrationEvidence evidence) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                UPDATE calibration_evidences SET
                    completed_at = ?, final_result = ?, calibration_state = ?, ready_for_session_at_completion = ?,
                    last_progress_id = ?, last_reason_id = ?, last_action_id = ?, firmware_state = ?, updated_at = ?
                WHERE id = ?
                """)) {
            statement.setString(1, toIso(evidence.completedAt()));
            statement.setString(2, evidence.finalResult());
            statement.setString(3, evidence.calibrationState());
            setNullableBoolean(statement, 4, evidence.readyForSessionAtCompletion());
            setNullableInteger(statement, 5, evidence.lastProgressId());
            statement.setString(6, evidence.lastReasonId());
            setNullableInteger(statement, 7, evidence.lastActionId());
            statement.setString(8, evidence.firmwareState());
            statement.setString(9, toIso(evidence.updatedAt()));
            statement.setLong(10, evidence.id());
            statement.executeUpdate();
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to update calibration evidence " + evidence.id(), error);
        }
    }

    public synchronized Optional<CalibrationEvidence> findLatestRunningEvidence(String deviceId) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                SELECT id, device_id, request_id, started_at, completed_at, final_result, calibration_state,
                       ready_for_session_at_completion, last_progress_id, last_reason_id, last_action_id,
                       firmware_state, profile_id, hall_delta, ref_pressure, bladder1_pressure, bladder2_pressure,
                       sample_interval_ms, calibration_window_ms, created_by_username, created_at, updated_at
                FROM calibration_evidences
                WHERE device_id = ? AND (final_result IS NULL OR final_result = 'RUNNING')
                ORDER BY started_at DESC, id DESC
                LIMIT 1
                """)) {
            statement.setString(1, deviceId);
            try (ResultSet resultSet = statement.executeQuery()) {
                if (!resultSet.next()) {
                    return Optional.empty();
                }
                return Optional.of(mapEvidence(resultSet));
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to find latest running evidence for device " + deviceId, error);
        }
    }

    public synchronized Optional<CalibrationEvidence> findEvidenceByRequestId(String deviceId, String requestId) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                SELECT id, device_id, request_id, started_at, completed_at, final_result, calibration_state,
                       ready_for_session_at_completion, last_progress_id, last_reason_id, last_action_id,
                       firmware_state, profile_id, hall_delta, ref_pressure, bladder1_pressure, bladder2_pressure,
                       sample_interval_ms, calibration_window_ms, created_by_username, created_at, updated_at
                FROM calibration_evidences
                WHERE device_id = ? AND request_id = ?
                ORDER BY started_at DESC, id DESC
                LIMIT 1
                """)) {
            statement.setString(1, deviceId);
            statement.setString(2, requestId);
            try (ResultSet resultSet = statement.executeQuery()) {
                if (!resultSet.next()) {
                    return Optional.empty();
                }
                return Optional.of(mapEvidence(resultSet));
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to find evidence by requestId for device " + deviceId, error);
        }
    }

    public synchronized Optional<CalibrationEvidence> findLatestEvidence(String deviceId) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                SELECT id, device_id, request_id, started_at, completed_at, final_result, calibration_state,
                       ready_for_session_at_completion, last_progress_id, last_reason_id, last_action_id,
                       firmware_state, profile_id, hall_delta, ref_pressure, bladder1_pressure, bladder2_pressure,
                       sample_interval_ms, calibration_window_ms, created_by_username, created_at, updated_at
                FROM calibration_evidences
                WHERE device_id = ?
                ORDER BY started_at DESC, id DESC
                LIMIT 1
                """)) {
            statement.setString(1, deviceId);
            try (ResultSet resultSet = statement.executeQuery()) {
                if (!resultSet.next()) {
                    return Optional.empty();
                }
                return Optional.of(mapEvidence(resultSet));
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to find latest evidence for device " + deviceId, error);
        }
    }

    public synchronized Optional<CalibrationEvidence> findEvidenceById(String deviceId, Long evidenceId) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                SELECT id, device_id, request_id, started_at, completed_at, final_result, calibration_state,
                       ready_for_session_at_completion, last_progress_id, last_reason_id, last_action_id,
                       firmware_state, profile_id, hall_delta, ref_pressure, bladder1_pressure, bladder2_pressure,
                       sample_interval_ms, calibration_window_ms, created_by_username, created_at, updated_at
                FROM calibration_evidences
                WHERE device_id = ? AND id = ?
                """)) {
            statement.setString(1, deviceId);
            statement.setLong(2, evidenceId);
            try (ResultSet resultSet = statement.executeQuery()) {
                if (!resultSet.next()) {
                    return Optional.empty();
                }
                return Optional.of(mapEvidence(resultSet));
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to find evidence by id for device " + deviceId, error);
        }
    }

    public synchronized List<CalibrationEvidence> findEvidenceHistory(String deviceId, int limit) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                SELECT id, device_id, request_id, started_at, completed_at, final_result, calibration_state,
                       ready_for_session_at_completion, last_progress_id, last_reason_id, last_action_id,
                       firmware_state, profile_id, hall_delta, ref_pressure, bladder1_pressure, bladder2_pressure,
                       sample_interval_ms, calibration_window_ms, created_by_username, created_at, updated_at
                FROM calibration_evidences
                WHERE device_id = ?
                ORDER BY started_at DESC, id DESC
                LIMIT ?
                """)) {
            statement.setString(1, deviceId);
            statement.setInt(2, limit);
            List<CalibrationEvidence> list = new ArrayList<>();
            try (ResultSet resultSet = statement.executeQuery()) {
                while (resultSet.next()) {
                    list.add(mapEvidence(resultSet));
                }
            }
            return list;
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to find evidence history for device " + deviceId, error);
        }
    }

    public synchronized void saveEventLog(CalibrationEventLog log) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO calibration_event_logs (
                    device_id, request_id, event_id, progress_id, result, status, reason_id, action_id,
                    firmware_state, ts_ms, received_at, raw_payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """)) {
            statement.setString(1, log.deviceId());
            statement.setString(2, log.requestId());
            setNullableInteger(statement, 3, log.eventId());
            setNullableInteger(statement, 4, log.progressId());
            statement.setString(5, log.result());
            statement.setString(6, log.status());
            statement.setString(7, log.reasonId());
            setNullableInteger(statement, 8, log.actionId());
            statement.setString(9, log.firmwareState());
            setNullableLong(statement, 10, log.tsMs());
            statement.setString(11, toIso(log.receivedAt()));
            statement.setString(12, limitString(log.rawPayloadJson(), MAX_RAW_PAYLOAD_CHARS));
            statement.executeUpdate();
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to save calibration event log for device " + log.deviceId(), error);
        }
    }

    public synchronized List<CalibrationEventLog> findEventLogsForRequest(String deviceId, String requestId) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                SELECT id, device_id, request_id, event_id, progress_id, result, status, reason_id, action_id,
                       firmware_state, ts_ms, received_at, raw_payload_json
                FROM calibration_event_logs
                WHERE device_id = ? AND request_id = ?
                ORDER BY received_at ASC, id ASC
                """)) {
            statement.setString(1, deviceId);
            statement.setString(2, requestId);
            List<CalibrationEventLog> list = new ArrayList<>();
            try (ResultSet resultSet = statement.executeQuery()) {
                while (resultSet.next()) {
                    list.add(mapEventLog(resultSet));
                }
            }
            return list;
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to load event logs for request " + requestId, error);
        }
    }

    private CalibrationEvidence mapEvidence(ResultSet resultSet) throws SQLException {
        return new CalibrationEvidence(
                resultSet.getLong("id"),
                resultSet.getString("device_id"),
                resultSet.getString("request_id"),
                parseInstant(resultSet.getString("started_at")),
                parseInstant(resultSet.getString("completed_at")),
                resultSet.getString("final_result"),
                resultSet.getString("calibration_state"),
                getNullableBoolean(resultSet, "ready_for_session_at_completion"),
                getNullableInteger(resultSet, "last_progress_id"),
                resultSet.getString("last_reason_id"),
                getNullableInteger(resultSet, "last_action_id"),
                resultSet.getString("firmware_state"),
                resultSet.getString("profile_id"),
                getNullableInteger(resultSet, "hall_delta"),
                getNullableInteger(resultSet, "ref_pressure"),
                getNullableInteger(resultSet, "bladder1_pressure"),
                getNullableInteger(resultSet, "bladder2_pressure"),
                getNullableInteger(resultSet, "sample_interval_ms"),
                getNullableInteger(resultSet, "calibration_window_ms"),
                resultSet.getString("created_by_username"),
                parseInstant(resultSet.getString("created_at")),
                parseInstant(resultSet.getString("updated_at"))
        );
    }

    private CalibrationEventLog mapEventLog(ResultSet resultSet) throws SQLException {
        return new CalibrationEventLog(
                resultSet.getLong("id"),
                resultSet.getString("device_id"),
                resultSet.getString("request_id"),
                getNullableInteger(resultSet, "event_id"),
                getNullableInteger(resultSet, "progress_id"),
                resultSet.getString("result"),
                resultSet.getString("status"),
                resultSet.getString("reason_id"),
                getNullableInteger(resultSet, "action_id"),
                resultSet.getString("firmware_state"),
                getNullableLong(resultSet, "ts_ms"),
                parseInstant(resultSet.getString("received_at")),
                resultSet.getString("raw_payload_json")
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

    private static void setNullableBoolean(PreparedStatement statement, int index, Boolean value) throws SQLException {
        if (value == null) {
            statement.setObject(index, null);
        } else {
            statement.setInt(index, value ? 1 : 0);
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

    private static Boolean getNullableBoolean(ResultSet resultSet, String column) throws SQLException {
        int value = resultSet.getInt(column);
        if (resultSet.wasNull()) {
            return null;
        }
        return value == 1;
    }

    private static String toIso(Instant instant) {
        return instant == null ? null : instant.toString();
    }

    private static Instant parseInstant(String value) {
        return value == null ? null : Instant.parse(value);
    }

    private static String limitString(String val, int limit) {
        if (val == null) return null;
        return val.length() <= limit ? val : val.substring(0, limit);
    }
}
