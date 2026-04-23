package lk.resq.localhub.service;

import lk.resq.localhub.model.SessionEndResponse;
import lk.resq.localhub.model.SessionSummary;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

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
                          trainee_id TEXT,
                          started_at TEXT NOT NULL,
                          ended_at TEXT NOT NULL,
                          scenario TEXT,
                          notes TEXT
                        )
                        """);
                statement.executeUpdate("""
                        CREATE TABLE IF NOT EXISTS session_metrics (
                          session_id TEXT PRIMARY KEY,
                          duration_seconds INTEGER NOT NULL,
                          avg_depth_mm REAL NOT NULL,
                          avg_rate_cpm REAL NOT NULL,
                          recoil_pct REAL NOT NULL,
                          pauses_count INTEGER NOT NULL,
                          score INTEGER NOT NULL,
                          latest_flags TEXT,
                          FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
                        )
                        """);
            }
        } catch (IOException | SQLException error) {
            throw new IllegalStateException("Failed to initialize local SQLite store at " + databasePath, error);
        }
    }

    public synchronized void save(SessionEndResponse session) {
        try (Connection connection = openConnection()) {
            connection.setAutoCommit(false);

            try (PreparedStatement sessionStatement = connection.prepareStatement("""
                    INSERT INTO sessions (session_id, device_id, trainee_id, started_at, ended_at, scenario, notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(session_id) DO UPDATE SET
                      device_id = excluded.device_id,
                      trainee_id = excluded.trainee_id,
                      started_at = excluded.started_at,
                      ended_at = excluded.ended_at,
                      scenario = excluded.scenario,
                      notes = excluded.notes
                    """);
                 PreparedStatement metricsStatement = connection.prepareStatement("""
                    INSERT INTO session_metrics (
                      session_id, duration_seconds, avg_depth_mm, avg_rate_cpm, recoil_pct, pauses_count, score, latest_flags
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(session_id) DO UPDATE SET
                      duration_seconds = excluded.duration_seconds,
                      avg_depth_mm = excluded.avg_depth_mm,
                      avg_rate_cpm = excluded.avg_rate_cpm,
                      recoil_pct = excluded.recoil_pct,
                      pauses_count = excluded.pauses_count,
                      score = excluded.score,
                      latest_flags = excluded.latest_flags
                    """)) {

                sessionStatement.setString(1, session.sessionId());
                sessionStatement.setString(2, session.deviceId());
                sessionStatement.setString(3, session.traineeId());
                sessionStatement.setString(4, session.startedAt().toString());
                sessionStatement.setString(5, session.endedAt().toString());
                sessionStatement.setString(6, session.scenario());
                sessionStatement.setString(7, session.notes());
                sessionStatement.executeUpdate();

                SessionSummary summary = session.summary();
                metricsStatement.setString(1, summary.sessionId());
                metricsStatement.setLong(2, summary.durationSeconds());
                metricsStatement.setDouble(3, summary.avgDepthMm());
                metricsStatement.setDouble(4, summary.avgRateCpm());
                metricsStatement.setDouble(5, summary.recoilPct());
                metricsStatement.setInt(6, summary.pausesCount());
                metricsStatement.setInt(7, summary.score());
                metricsStatement.setString(8, summary.latestFlags());
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
                       m.duration_seconds,
                       m.avg_depth_mm,
                       m.avg_rate_cpm,
                       m.recoil_pct,
                       m.pauses_count,
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
                       m.duration_seconds,
                       m.avg_depth_mm,
                       m.avg_rate_cpm,
                       m.recoil_pct,
                       m.pauses_count,
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

    private SessionEndResponse mapRow(ResultSet resultSet) throws SQLException {
        SessionSummary summary = new SessionSummary(
                resultSet.getString("session_id"),
                resultSet.getString("device_id"),
                resultSet.getString("trainee_id"),
                parseInstant(resultSet.getString("started_at")),
                parseInstant(resultSet.getString("ended_at")),
                resultSet.getLong("duration_seconds"),
                resultSet.getDouble("avg_depth_mm"),
                resultSet.getDouble("avg_rate_cpm"),
                resultSet.getDouble("recoil_pct"),
                resultSet.getInt("pauses_count"),
                resultSet.getInt("score"),
                resultSet.getString("latest_flags")
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
                summary
        );
    }

    private Connection openConnection() throws SQLException {
        return DriverManager.getConnection(jdbcUrl);
    }

    private static Instant parseInstant(String value) {
        return value == null ? null : Instant.parse(value);
    }
}