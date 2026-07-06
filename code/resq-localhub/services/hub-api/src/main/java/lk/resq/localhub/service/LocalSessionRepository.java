package lk.resq.localhub.service;

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

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import lk.resq.localhub.model.SessionEndResponse;
import lk.resq.localhub.model.SessionSummary;
import lk.resq.localhub.model.cpr.CprSessionSummaryQueryRequest;
import lk.resq.localhub.model.cpr.CprSessionSummaryRequest;
import lk.resq.localhub.model.cpr.CprSessionSummaryResponse;

@Service
public class LocalSessionRepository {

    private final Path databasePath;
    private final String jdbcUrl;

    public LocalSessionRepository(@Value("${resq.storage.sqlite-path:${user.home}/.resq-localhub/hub-api.sqlite}") String sqlitePath) {
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
                        CREATE TABLE IF NOT EXISTS sessions (
                          session_id TEXT PRIMARY KEY,
                          device_id TEXT NOT NULL,
                                                    user_id TEXT,
                          trainee_id TEXT,
                          started_at TEXT NOT NULL,
                          ended_at TEXT NOT NULL,
                          scenario TEXT,
                                                    notes TEXT,
                                                    created_at TEXT,
                                                    duration_seconds INTEGER NOT NULL DEFAULT 0,
                                                    avg_depth_mm REAL NOT NULL DEFAULT 0,
                                                    min_depth_mm REAL NOT NULL DEFAULT 0,
                                                    max_depth_mm REAL NOT NULL DEFAULT 0,
                                                    depth_accuracy_percent REAL NOT NULL DEFAULT 0,
                                                    avg_rate_cpm REAL NOT NULL DEFAULT 0,
                                                    rate_accuracy_percent REAL NOT NULL DEFAULT 0,
                                                    recoil_error_percent REAL NOT NULL DEFAULT 0,
                                                    pause_count INTEGER NOT NULL DEFAULT 0,
                                                    longest_pause_seconds REAL NOT NULL DEFAULT 0,
                                                    consistency_score REAL NOT NULL DEFAULT 0,
                                                    fatigue_drop_percent REAL NOT NULL DEFAULT 0,
                                                    overall_score INTEGER NOT NULL DEFAULT 0
                        )
                        """);
                statement.executeUpdate("""
                        CREATE TABLE IF NOT EXISTS session_metrics (
                          session_id TEXT PRIMARY KEY,
                                                    sample_count INTEGER NOT NULL DEFAULT 0,
                                                    total_compressions INTEGER NOT NULL DEFAULT 0,
                                                    valid_compressions INTEGER NOT NULL DEFAULT 0,
                          duration_seconds INTEGER NOT NULL,
                          avg_depth_mm REAL NOT NULL,
                                                    avg_depth_progress REAL,
                                                    min_depth_mm REAL NOT NULL DEFAULT 0,
                                                    max_depth_mm REAL NOT NULL DEFAULT 0,
                                                    depth_accuracy_percent REAL NOT NULL DEFAULT 0,
                          avg_rate_cpm REAL NOT NULL,
                                                    rate_accuracy_percent REAL NOT NULL DEFAULT 0,
                                                    recoil_pct REAL NOT NULL,
                                                    recoil_error_percent REAL NOT NULL DEFAULT 0,
                                                    recoil_ok_count INTEGER NOT NULL DEFAULT 0,
                                                    incomplete_recoil_count INTEGER NOT NULL DEFAULT 0,
                          pauses_count INTEGER NOT NULL,
                                                    longest_pause_seconds REAL NOT NULL DEFAULT 0,
                                                    consistency_score REAL NOT NULL DEFAULT 0,
                                                    fatigue_drop_percent REAL NOT NULL DEFAULT 0,
                          score INTEGER NOT NULL,
                          latest_flags TEXT,
                          FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
                        )
                        """);
                ensureColumn(connection, "session_metrics", "sample_count", "INTEGER NOT NULL DEFAULT 0");
                ensureColumn(connection, "session_metrics", "total_compressions", "INTEGER NOT NULL DEFAULT 0");
                ensureColumn(connection, "session_metrics", "valid_compressions", "INTEGER NOT NULL DEFAULT 0");
                ensureColumn(connection, "session_metrics", "avg_depth_progress", "REAL");
                ensureColumn(connection, "sessions", "user_id", "TEXT NULL");
                ensureColumn(connection, "sessions", "created_at", "TEXT NULL");
                ensureColumn(connection, "sessions", "duration_seconds", "INTEGER NOT NULL DEFAULT 0");
                ensureColumn(connection, "sessions", "avg_depth_mm", "REAL NOT NULL DEFAULT 0");
                                ensureColumn(connection, "session_metrics", "min_depth_mm", "REAL NOT NULL DEFAULT 0");
                                ensureColumn(connection, "session_metrics", "max_depth_mm", "REAL NOT NULL DEFAULT 0");
                                ensureColumn(connection, "session_metrics", "depth_accuracy_percent", "REAL NOT NULL DEFAULT 0");
                                ensureColumn(connection, "session_metrics", "rate_accuracy_percent", "REAL NOT NULL DEFAULT 0");
                                ensureColumn(connection, "session_metrics", "recoil_error_percent", "REAL NOT NULL DEFAULT 0");
                ensureColumn(connection, "sessions", "min_depth_mm", "REAL NOT NULL DEFAULT 0");
                ensureColumn(connection, "sessions", "max_depth_mm", "REAL NOT NULL DEFAULT 0");
                ensureColumn(connection, "sessions", "depth_accuracy_percent", "REAL NOT NULL DEFAULT 0");
                ensureColumn(connection, "sessions", "avg_rate_cpm", "REAL NOT NULL DEFAULT 0");
                ensureColumn(connection, "sessions", "rate_accuracy_percent", "REAL NOT NULL DEFAULT 0");
                ensureColumn(connection, "sessions", "recoil_error_percent", "REAL NOT NULL DEFAULT 0");
                ensureColumn(connection, "sessions", "pause_count", "INTEGER NOT NULL DEFAULT 0");
                ensureColumn(connection, "sessions", "longest_pause_seconds", "REAL NOT NULL DEFAULT 0");
                ensureColumn(connection, "sessions", "consistency_score", "REAL NOT NULL DEFAULT 0");
                ensureColumn(connection, "sessions", "fatigue_drop_percent", "REAL NOT NULL DEFAULT 0");
                ensureColumn(connection, "sessions", "overall_score", "INTEGER NOT NULL DEFAULT 0");
                ensureColumn(connection, "session_metrics", "recoil_ok_count", "INTEGER NOT NULL DEFAULT 0");
                ensureColumn(connection, "session_metrics", "incomplete_recoil_count", "INTEGER NOT NULL DEFAULT 0");
                                ensureColumn(connection, "session_metrics", "longest_pause_seconds", "REAL NOT NULL DEFAULT 0");
                                ensureColumn(connection, "session_metrics", "consistency_score", "REAL NOT NULL DEFAULT 0");
                                ensureColumn(connection, "session_metrics", "fatigue_drop_percent", "REAL NOT NULL DEFAULT 0");
                ensureColumn(connection, "sessions", "trainee_id", "TEXT NULL");
                ensureColumn(connection, "sessions", "course_id", "TEXT NULL");
                ensureColumn(connection, "sessions", "instructor_id", "TEXT NULL");
            }
        } catch (IOException | SQLException error) {
            throw new IllegalStateException("Failed to initialize local SQLite store at " + databasePath, error);
        }
    }

    public synchronized void save(SessionEndResponse session) {
        try (Connection connection = openConnection()) {
            connection.setAutoCommit(false);

            try (PreparedStatement sessionStatement = connection.prepareStatement("""
                                        INSERT INTO sessions (session_id, device_id, user_id, trainee_id, started_at, ended_at, scenario, notes, created_at, duration_seconds, avg_depth_mm, min_depth_mm, max_depth_mm, depth_accuracy_percent, avg_rate_cpm, rate_accuracy_percent, recoil_error_percent, pause_count, longest_pause_seconds, consistency_score, fatigue_drop_percent, overall_score, course_id, instructor_id)
                                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(session_id) DO UPDATE SET
                      device_id = excluded.device_id,
                                            user_id = excluded.user_id,
                      trainee_id = excluded.trainee_id,
                      started_at = excluded.started_at,
                      ended_at = excluded.ended_at,
                      scenario = excluded.scenario,
                      notes = excluded.notes,
                                            created_at = excluded.created_at,
                                            duration_seconds = excluded.duration_seconds,
                                            avg_depth_mm = excluded.avg_depth_mm,
                                            min_depth_mm = excluded.min_depth_mm,
                                            max_depth_mm = excluded.max_depth_mm,
                                            depth_accuracy_percent = excluded.depth_accuracy_percent,
                                            avg_rate_cpm = excluded.avg_rate_cpm,
                                            rate_accuracy_percent = excluded.rate_accuracy_percent,
                                            recoil_error_percent = excluded.recoil_error_percent,
                                            pause_count = excluded.pause_count,
                                            longest_pause_seconds = excluded.longest_pause_seconds,
                                            consistency_score = excluded.consistency_score,
                                            fatigue_drop_percent = excluded.fatigue_drop_percent,
                                            overall_score = excluded.overall_score,
                      course_id = excluded.course_id,
                      instructor_id = excluded.instructor_id
                    """);
                 PreparedStatement metricsStatement = connection.prepareStatement("""
                    INSERT INTO session_metrics (
                                                                                        session_id, sample_count, total_compressions, valid_compressions, duration_seconds, avg_depth_mm, avg_depth_progress, min_depth_mm, max_depth_mm, depth_accuracy_percent, avg_rate_cpm, rate_accuracy_percent, recoil_pct, recoil_error_percent, recoil_ok_count, incomplete_recoil_count, pauses_count, longest_pause_seconds, consistency_score, fatigue_drop_percent, score, latest_flags
                                                                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(session_id) DO UPDATE SET
                                            sample_count = excluded.sample_count,
                                            total_compressions = excluded.total_compressions,
                                            valid_compressions = excluded.valid_compressions,
                      duration_seconds = excluded.duration_seconds,
                      avg_depth_mm = excluded.avg_depth_mm,
                                            avg_depth_progress = excluded.avg_depth_progress,
                                            min_depth_mm = excluded.min_depth_mm,
                                            max_depth_mm = excluded.max_depth_mm,
                                            depth_accuracy_percent = excluded.depth_accuracy_percent,
                      avg_rate_cpm = excluded.avg_rate_cpm,
                                            rate_accuracy_percent = excluded.rate_accuracy_percent,
                      recoil_pct = excluded.recoil_pct,
                                            recoil_error_percent = excluded.recoil_error_percent,
                                            recoil_ok_count = excluded.recoil_ok_count,
                                            incomplete_recoil_count = excluded.incomplete_recoil_count,
                      pauses_count = excluded.pauses_count,
                                            longest_pause_seconds = excluded.longest_pause_seconds,
                                            consistency_score = excluded.consistency_score,
                                            fatigue_drop_percent = excluded.fatigue_drop_percent,
                      score = excluded.score,
                      latest_flags = excluded.latest_flags
                    """)) {

                sessionStatement.setString(1, session.sessionId());
                sessionStatement.setString(2, session.deviceId());
                sessionStatement.setString(3, session.traineeId());
                sessionStatement.setString(4, session.traineeId());
                sessionStatement.setString(5, session.startedAt().toString());
                sessionStatement.setString(6, session.endedAt().toString());
                sessionStatement.setString(7, session.scenario());
                sessionStatement.setString(8, session.notes());
                sessionStatement.setString(9, session.endedAt().toString());
                SessionSummary summary = session.summary();
                sessionStatement.setLong(10, summary.durationSeconds());
                sessionStatement.setDouble(11, summary.avgDepthMm());
                sessionStatement.setDouble(12, summary.minDepthMm());
                sessionStatement.setDouble(13, summary.maxDepthMm());
                sessionStatement.setDouble(14, summary.depthAccuracyPercent());
                sessionStatement.setDouble(15, summary.avgRateCpm());
                sessionStatement.setDouble(16, summary.rateAccuracyPercent());
                sessionStatement.setDouble(17, summary.recoilErrorPercent());
                sessionStatement.setInt(18, summary.pausesCount());
                sessionStatement.setDouble(19, summary.longestPauseSeconds());
                sessionStatement.setDouble(20, summary.consistencyScore());
                sessionStatement.setDouble(21, summary.fatigueDropPercent());
                sessionStatement.setInt(22, summary.score());
                sessionStatement.setString(23, session.courseId());
                sessionStatement.setString(24, session.instructorId());
                sessionStatement.executeUpdate();

                metricsStatement.setString(1, summary.sessionId());
                metricsStatement.setInt(2, summary.sampleCount());
                metricsStatement.setInt(3, summary.totalCompressions());
                metricsStatement.setInt(4, summary.validCompressions());
                metricsStatement.setLong(5, summary.durationSeconds());
                metricsStatement.setDouble(6, summary.avgDepthMm());
                if (summary.avgDepthProgress() == null) {
                    metricsStatement.setNull(7, java.sql.Types.REAL);
                } else {
                    metricsStatement.setDouble(7, summary.avgDepthProgress());
                }
                metricsStatement.setDouble(8, summary.minDepthMm());
                metricsStatement.setDouble(9, summary.maxDepthMm());
                metricsStatement.setDouble(10, summary.depthAccuracyPercent());
                metricsStatement.setDouble(11, summary.avgRateCpm());
                metricsStatement.setDouble(12, summary.rateAccuracyPercent());
                metricsStatement.setDouble(13, summary.recoilPct());
                metricsStatement.setDouble(14, summary.recoilErrorPercent());
                metricsStatement.setInt(15, summary.recoilOkCount());
                metricsStatement.setInt(16, summary.incompleteRecoilCount());
                metricsStatement.setInt(17, summary.pausesCount());
                metricsStatement.setDouble(18, summary.longestPauseSeconds());
                metricsStatement.setDouble(19, summary.consistencyScore());
                metricsStatement.setDouble(20, summary.fatigueDropPercent());
                metricsStatement.setInt(21, summary.score());
                metricsStatement.setString(22, summary.latestFlags());
                metricsStatement.executeUpdate();

                connection.commit();
            } catch (SQLException error) {
                connection.rollback();
                throw error;
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to persist session " + session.sessionId(), error);
        }
    }

    public synchronized Optional<SessionEndResponse> findById(String sessionId) {
        try (Connection connection = openConnection();
             PreparedStatement statement = connection.prepareStatement("""
                     SELECT
                       s.session_id,
                       s.device_id,
                       s.trainee_id,
                       s.started_at,
                       s.ended_at,
                       s.scenario,
                       s.notes,
                       s.course_id,
                       s.instructor_id,
                       m.sample_count,
                       m.total_compressions,
                       m.valid_compressions,
                       m.duration_seconds,
                       m.avg_depth_mm,
                       m.avg_depth_progress,
                       COALESCE(m.min_depth_mm, 0) AS min_depth_mm,
                       COALESCE(m.max_depth_mm, 0) AS max_depth_mm,
                       COALESCE(m.depth_accuracy_percent, 0) AS depth_accuracy_percent,
                       m.avg_rate_cpm,
                       COALESCE(m.rate_accuracy_percent, 0) AS rate_accuracy_percent,
                       m.recoil_pct,
                       COALESCE(m.recoil_error_percent, 0) AS recoil_error_percent,
                       m.recoil_ok_count,
                       m.incomplete_recoil_count,
                       m.pauses_count,
                       COALESCE(m.longest_pause_seconds, 0) AS longest_pause_seconds,
                       COALESCE(m.consistency_score, 0) AS consistency_score,
                       COALESCE(m.fatigue_drop_percent, 0) AS fatigue_drop_percent,
                       m.score,
                       m.latest_flags
                     FROM sessions s
                     JOIN session_metrics m ON m.session_id = s.session_id
                     WHERE s.session_id = ?
                     """)) {
            statement.setString(1, sessionId);

            try (ResultSet resultSet = statement.executeQuery()) {
                if (!resultSet.next()) {
                    return Optional.empty();
                }

                return Optional.of(mapRow(resultSet));
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to load session " + sessionId, error);
        }
    }

    public synchronized List<SessionEndResponse> findAll() {
        try (Connection connection = openConnection();
             PreparedStatement statement = connection.prepareStatement("""
                     SELECT
                       s.session_id,
                       s.device_id,
                       s.trainee_id,
                       s.started_at,
                       s.ended_at,
                       s.scenario,
                       s.notes,
                       s.course_id,
                       s.instructor_id,
                       m.sample_count,
                       m.total_compressions,
                       m.valid_compressions,
                       m.duration_seconds,
                       m.avg_depth_mm,
                       m.avg_depth_progress,
                       COALESCE(m.min_depth_mm, 0) AS min_depth_mm,
                       COALESCE(m.max_depth_mm, 0) AS max_depth_mm,
                       COALESCE(m.depth_accuracy_percent, 0) AS depth_accuracy_percent,
                       m.avg_rate_cpm,
                       COALESCE(m.rate_accuracy_percent, 0) AS rate_accuracy_percent,
                       m.recoil_pct,
                       COALESCE(m.recoil_error_percent, 0) AS recoil_error_percent,
                       m.recoil_ok_count,
                       m.incomplete_recoil_count,
                       m.pauses_count,
                       COALESCE(m.longest_pause_seconds, 0) AS longest_pause_seconds,
                       COALESCE(m.consistency_score, 0) AS consistency_score,
                       COALESCE(m.fatigue_drop_percent, 0) AS fatigue_drop_percent,
                       m.score,
                       m.latest_flags
                     FROM sessions s
                     JOIN session_metrics m ON m.session_id = s.session_id
                     ORDER BY s.ended_at DESC
                     """)) {
            List<SessionEndResponse> sessions = new ArrayList<>();
            try (ResultSet resultSet = statement.executeQuery()) {
                while (resultSet.next()) {
                    sessions.add(mapRow(resultSet));
                }
            }
            return sessions;
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to load completed sessions", error);
        }
    }

    public synchronized List<SessionEndResponse> findByTraineeIdOrUsernameOrEmail(String traineeId, String username, String email) {
        try (Connection connection = openConnection()) {
            StringBuilder sql = new StringBuilder("""
                     SELECT
                       s.session_id,
                       s.device_id,
                       s.trainee_id,
                       s.started_at,
                       s.ended_at,
                       s.scenario,
                       s.notes,
                       s.course_id,
                       s.instructor_id,
                       m.sample_count,
                       m.total_compressions,
                       m.valid_compressions,
                       m.duration_seconds,
                       m.avg_depth_mm,
                       m.avg_depth_progress,
                       COALESCE(m.min_depth_mm, 0) AS min_depth_mm,
                       COALESCE(m.max_depth_mm, 0) AS max_depth_mm,
                       COALESCE(m.depth_accuracy_percent, 0) AS depth_accuracy_percent,
                       m.avg_rate_cpm,
                       COALESCE(m.rate_accuracy_percent, 0) AS rate_accuracy_percent,
                       m.recoil_pct,
                       COALESCE(m.recoil_error_percent, 0) AS recoil_error_percent,
                       m.recoil_ok_count,
                       m.incomplete_recoil_count,
                       m.pauses_count,
                       COALESCE(m.longest_pause_seconds, 0) AS longest_pause_seconds,
                       COALESCE(m.consistency_score, 0) AS consistency_score,
                       COALESCE(m.fatigue_drop_percent, 0) AS fatigue_drop_percent,
                       m.score,
                       m.latest_flags
                     FROM sessions s
                     JOIN session_metrics m ON m.session_id = s.session_id
                     WHERE 1=0
                     """);
            
            List<String> params = new ArrayList<>();
            if (traineeId != null && !traineeId.isBlank()) {
                sql.append(" OR LOWER(s.trainee_id) = ?");
                params.add(traineeId.trim().toLowerCase());
            }
            if (username != null && !username.isBlank()) {
                sql.append(" OR LOWER(s.trainee_id) = ?");
                params.add(username.trim().toLowerCase());
            }
            if (email != null && !email.isBlank()) {
                sql.append(" OR LOWER(s.trainee_id) = ?");
                params.add(email.trim().toLowerCase());
            }
            
            sql.append(" ORDER BY s.ended_at DESC");
            
            try (PreparedStatement statement = connection.prepareStatement(sql.toString())) {
                for (int i = 0; i < params.size(); i++) {
                    statement.setString(i + 1, params.get(i));
                }
                
                List<SessionEndResponse> sessions = new ArrayList<>();
                try (ResultSet resultSet = statement.executeQuery()) {
                    while (resultSet.next()) {
                        sessions.add(mapRow(resultSet));
                    }
                }
                return sessions;
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to load completed sessions for trainee", error);
        }
    }

    public synchronized void saveCprSession(CprSessionSummaryRequest request, Instant createdAt) {
        try (Connection connection = openConnection();
             PreparedStatement statement = connection.prepareStatement("""
                     INSERT INTO sessions (
                       session_id,
                       device_id,
                       user_id,
                       trainee_id,
                       started_at,
                       ended_at,
                       scenario,
                       notes,
                       created_at,
                       duration_seconds,
                       avg_depth_mm,
                       min_depth_mm,
                       max_depth_mm,
                       depth_accuracy_percent,
                       avg_rate_cpm,
                       rate_accuracy_percent,
                       recoil_error_percent,
                       pause_count,
                       longest_pause_seconds,
                       consistency_score,
                       fatigue_drop_percent,
                       overall_score,
                       course_id,
                       instructor_id
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT(session_id) DO UPDATE SET
                       device_id = excluded.device_id,
                       user_id = excluded.user_id,
                       trainee_id = excluded.trainee_id,
                       started_at = excluded.started_at,
                       ended_at = excluded.ended_at,
                       scenario = excluded.scenario,
                       notes = excluded.notes,
                       created_at = excluded.created_at,
                       duration_seconds = excluded.duration_seconds,
                       avg_depth_mm = excluded.avg_depth_mm,
                       min_depth_mm = excluded.min_depth_mm,
                       max_depth_mm = excluded.max_depth_mm,
                       depth_accuracy_percent = excluded.depth_accuracy_percent,
                       avg_rate_cpm = excluded.avg_rate_cpm,
                       rate_accuracy_percent = excluded.rate_accuracy_percent,
                       recoil_error_percent = excluded.recoil_error_percent,
                       pause_count = excluded.pause_count,
                       longest_pause_seconds = excluded.longest_pause_seconds,
                       consistency_score = excluded.consistency_score,
                       fatigue_drop_percent = excluded.fatigue_drop_percent,
                       overall_score = excluded.overall_score
                     """)) {
            statement.setString(1, request.id());
            statement.setString(2, request.manikinId());
            statement.setString(3, firstNonBlank(request.userId(), request.traineeId()));
            statement.setString(4, request.traineeId());
            statement.setString(5, request.startedAt().toString());
            statement.setString(6, request.endedAt().toString());
            statement.setNull(7, java.sql.Types.VARCHAR);
            statement.setNull(8, java.sql.Types.VARCHAR);
            statement.setString(9, createdAt.toString());
            statement.setLong(10, request.durationSeconds());
            statement.setDouble(11, request.avgDepthMm());
            statement.setDouble(12, request.minDepthMm());
            statement.setDouble(13, request.maxDepthMm());
            statement.setDouble(14, request.depthAccuracyPercent());
            statement.setDouble(15, request.avgRateCpm());
            statement.setDouble(16, request.rateAccuracyPercent());
            statement.setDouble(17, request.recoilErrorPercent());
            statement.setInt(18, request.pauseCount());
            statement.setDouble(19, request.longestPauseSeconds());
            statement.setDouble(20, request.consistencyScore());
            statement.setDouble(21, request.fatigueDropPercent());
            statement.setInt(22, request.overallScore());
            statement.setNull(23, java.sql.Types.VARCHAR);
            statement.setNull(24, java.sql.Types.VARCHAR);
            statement.executeUpdate();
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to persist CPR session " + request.id(), error);
        }
    }

    public synchronized Optional<CprSessionSummaryResponse> findCprSessionById(String id) {
        try (Connection connection = openConnection();
             PreparedStatement statement = connection.prepareStatement("""
                     SELECT
                       session_id,
                       device_id,
                       user_id,
                       trainee_id,
                       started_at,
                       ended_at,
                       COALESCE(NULLIF(created_at, ''), ended_at) AS created_at,
                       duration_seconds,
                       avg_depth_mm,
                       min_depth_mm,
                       max_depth_mm,
                       depth_accuracy_percent,
                       avg_rate_cpm,
                       rate_accuracy_percent,
                       recoil_error_percent,
                       pause_count,
                       longest_pause_seconds,
                       consistency_score,
                       fatigue_drop_percent,
                       overall_score
                     FROM sessions
                     WHERE session_id = ?
                     """)) {
            statement.setString(1, id);
            try (ResultSet resultSet = statement.executeQuery()) {
                if (!resultSet.next()) {
                    return Optional.empty();
                }
                return Optional.of(mapCprSession(resultSet));
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to load CPR session " + id, error);
        }
    }

    public synchronized List<CprSessionSummaryResponse> findCprSessions(CprSessionSummaryQueryRequest query) {
        try (Connection connection = openConnection()) {
            StringBuilder sql = new StringBuilder("""
                    SELECT
                      session_id,
                      device_id,
                      user_id,
                      trainee_id,
                      started_at,
                      ended_at,
                      COALESCE(NULLIF(created_at, ''), ended_at) AS created_at,
                      duration_seconds,
                      avg_depth_mm,
                      min_depth_mm,
                      max_depth_mm,
                      depth_accuracy_percent,
                      avg_rate_cpm,
                      rate_accuracy_percent,
                      recoil_error_percent,
                      pause_count,
                      longest_pause_seconds,
                      consistency_score,
                      fatigue_drop_percent,
                      overall_score
                    FROM sessions
                    WHERE 1 = 1
                    """);

            List<Object> parameters = new ArrayList<>();
            if (hasText(query.userId())) {
                sql.append(" AND (LOWER(user_id) = ? OR LOWER(trainee_id) = ?)");
                String value = query.userId().trim().toLowerCase();
                parameters.add(value);
                parameters.add(value);
            }
            if (hasText(query.traineeId())) {
                sql.append(" AND LOWER(trainee_id) = ?");
                parameters.add(query.traineeId().trim().toLowerCase());
            }
            Instant from = parseOptionalInstant(query.from(), "from");
            if (from != null) {
                sql.append(" AND COALESCE(NULLIF(created_at, ''), ended_at) >= ?");
                parameters.add(from.toString());
            }
            Instant to = parseOptionalInstant(query.to(), "to");
            if (to != null) {
                sql.append(" AND COALESCE(NULLIF(created_at, ''), ended_at) <= ?");
                parameters.add(to.toString());
            }
            if (hasText(query.manikinId())) {
                sql.append(" AND LOWER(device_id) = ?");
                parameters.add(query.manikinId().trim().toLowerCase());
            }

            sql.append(" ORDER BY COALESCE(NULLIF(created_at, ''), ended_at) DESC, session_id DESC");

            try (PreparedStatement statement = connection.prepareStatement(sql.toString())) {
                for (int i = 0; i < parameters.size(); i++) {
                    Object parameter = parameters.get(i);
                    statement.setString(i + 1, parameter == null ? null : parameter.toString());
                }

                List<CprSessionSummaryResponse> sessions = new ArrayList<>();
                try (ResultSet resultSet = statement.executeQuery()) {
                    while (resultSet.next()) {
                        sessions.add(mapCprSession(resultSet));
                    }
                }
                return sessions;
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to load CPR sessions", error);
        }
    }

    private SessionEndResponse mapRow(ResultSet resultSet) throws SQLException {
        SessionSummary summary = new SessionSummary(
                resultSet.getString("session_id"),
                resultSet.getString("device_id"),
                resultSet.getString("trainee_id"),
                parseInstant(resultSet.getString("started_at")),
                parseInstant(resultSet.getString("ended_at")),
            Math.max(1L, resultSet.getLong("duration_seconds")),
                resultSet.getInt("sample_count"),
                resultSet.getInt("total_compressions"),
                resultSet.getInt("valid_compressions"),
                resultSet.getDouble("avg_depth_mm"),
                nullableDouble(resultSet, "avg_depth_progress"),
                resultSet.getDouble("avg_rate_cpm"),
                resultSet.getDouble("recoil_pct"),
                resultSet.getInt("recoil_ok_count"),
                resultSet.getInt("incomplete_recoil_count"),
                resultSet.getInt("pauses_count"),
                resultSet.getInt("score"),
                resultSet.getString("latest_flags"),
                resultSet.getDouble("min_depth_mm"),
                resultSet.getDouble("max_depth_mm"),
                resultSet.getDouble("depth_accuracy_percent"),
                resultSet.getDouble("rate_accuracy_percent"),
                resultSet.getDouble("recoil_error_percent"),
                resultSet.getDouble("longest_pause_seconds"),
                resultSet.getDouble("consistency_score"),
                resultSet.getDouble("fatigue_drop_percent")
        );

        return new SessionEndResponse(
                resultSet.getString("session_id"),
                resultSet.getString("device_id"),
                resultSet.getString("trainee_id"),
                parseInstant(resultSet.getString("started_at")),
                true,
                parseInstant(resultSet.getString("ended_at")),
                resultSet.getString("scenario"),
                resultSet.getString("notes"),
                summary,
                resultSet.getString("course_id"),
                resultSet.getString("instructor_id")
        );
    }

    private Connection openConnection() throws SQLException {
        return DriverManager.getConnection(jdbcUrl);
    }

    private static Instant parseInstant(String value) {
        return value == null ? null : Instant.parse(value);
    }

    private static void ensureColumn(Connection connection, String tableName, String columnName, String definition) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("PRAGMA table_info(" + tableName + ")")) {
            try (ResultSet resultSet = statement.executeQuery()) {
                while (resultSet.next()) {
                    if (columnName.equalsIgnoreCase(resultSet.getString("name"))) {
                        return;
                    }
                }
            }
        }

        try (Statement statement = connection.createStatement()) {
            statement.executeUpdate("ALTER TABLE " + tableName + " ADD COLUMN " + columnName + " " + definition);
        }
    }

    private static Double nullableDouble(ResultSet resultSet, String columnLabel) throws SQLException {
        double value = resultSet.getDouble(columnLabel);
        return resultSet.wasNull() ? null : value;
    }

    private static CprSessionSummaryResponse mapCprSession(ResultSet resultSet) throws SQLException {
        return new CprSessionSummaryResponse(
                resultSet.getString("session_id"),
                resultSet.getString("user_id"),
                resultSet.getString("trainee_id"),
                resultSet.getString("device_id"),
                parseInstant(resultSet.getString("started_at")),
                parseInstant(resultSet.getString("ended_at")),
                resultSet.getLong("duration_seconds"),
                resultSet.getDouble("avg_depth_mm"),
                resultSet.getDouble("min_depth_mm"),
                resultSet.getDouble("max_depth_mm"),
                resultSet.getDouble("depth_accuracy_percent"),
                resultSet.getDouble("avg_rate_cpm"),
                resultSet.getDouble("rate_accuracy_percent"),
                resultSet.getDouble("recoil_error_percent"),
                resultSet.getInt("pause_count"),
                resultSet.getDouble("longest_pause_seconds"),
                resultSet.getDouble("consistency_score"),
                resultSet.getDouble("fatigue_drop_percent"),
                resultSet.getInt("overall_score"),
                parseInstant(resultSet.getString("created_at"))
        );
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private static Instant parseOptionalInstant(String value, String fieldName) {
        if (!hasText(value)) {
            return null;
        }

        try {
            return Instant.parse(value.trim());
        } catch (Exception error) {
            throw new IllegalArgumentException(fieldName + " must be an ISO-8601 instant", error);
        }
    }

    private static String firstNonBlank(String first, String second) {
        if (hasText(first)) {
            return first.trim();
        }
        if (hasText(second)) {
            return second.trim();
        }
        return null;
    }
}