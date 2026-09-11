package lk.resq.localhub.service;

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

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import lk.resq.localhub.model.cpr.CprSessionSummaryQueryRequest;
import lk.resq.localhub.model.cpr.CprSessionSummaryResponse;

@Service
public class CprAiSessionRepository {

    private final Path databasePath;
    private final String jdbcUrl;

    @Autowired
    public CprAiSessionRepository(
            @Value("${resq.storage.sqlite-path:${user.home}/.resq-localhub/hub-api.sqlite}") String sqlitePath
    ) {
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
                        CREATE TABLE IF NOT EXISTS cpr_session_summaries (
                            session_id TEXT PRIMARY KEY,
                            user_id TEXT,
                            trainee_id TEXT,
                            device_id TEXT,
                            started_at TEXT,
                            ended_at TEXT,
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
                            overall_score INTEGER NOT NULL DEFAULT 0,
                            created_at TEXT,
                            data_source TEXT
                        )
                        """);
            }
        } catch (Exception error) {
            throw new IllegalStateException("Failed to initialize CPR AI database tables at " + databasePath, error);
        }
    }

    public synchronized void saveCprSession(CprSessionSummaryResponse summary) {
        if (summary == null || summary.id() == null || summary.id().isBlank()) {
            throw new IllegalArgumentException("session id cannot be null or blank");
        }

        String sql = """
                INSERT INTO cpr_session_summaries (
                    session_id, user_id, trainee_id, device_id, started_at, ended_at,
                    duration_seconds, avg_depth_mm, min_depth_mm, max_depth_mm, depth_accuracy_percent,
                    avg_rate_cpm, rate_accuracy_percent, recoil_error_percent, pause_count,
                    longest_pause_seconds, consistency_score, fatigue_drop_percent, overall_score,
                    created_at, data_source
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                    user_id = excluded.user_id,
                    trainee_id = excluded.trainee_id,
                    device_id = excluded.device_id,
                    started_at = excluded.started_at,
                    ended_at = excluded.ended_at,
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
                    created_at = excluded.created_at,
                    data_source = excluded.data_source
                """;

        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement(sql)) {
            Instant createdAt = summary.createdAt() != null ? summary.createdAt() : Instant.now();
            statement.setString(1, summary.id());
            statement.setString(2, firstNonBlank(summary.userId(), summary.traineeId()));
            statement.setString(3, summary.traineeId());
            statement.setString(4, summary.manikinId());
            statement.setString(5, summary.startedAt() != null ? summary.startedAt().toString() : null);
            statement.setString(6, summary.endedAt() != null ? summary.endedAt().toString() : null);
            statement.setLong(7, summary.durationSeconds());
            statement.setDouble(8, summary.avgDepthMm());
            statement.setDouble(9, summary.minDepthMm());
            statement.setDouble(10, summary.maxDepthMm());
            statement.setDouble(11, summary.depthAccuracyPercent());
            statement.setDouble(12, summary.avgRateCpm());
            statement.setDouble(13, summary.rateAccuracyPercent());
            statement.setDouble(14, summary.recoilErrorPercent());
            statement.setInt(15, summary.pauseCount());
            statement.setDouble(16, summary.longestPauseSeconds());
            statement.setDouble(17, summary.consistencyScore());
            statement.setDouble(18, summary.fatigueDropPercent());
            statement.setInt(19, summary.overallScore());
            statement.setString(20, createdAt.toString());
            statement.setString(21, summary.dataSource() != null ? summary.dataSource() : "REAL_SENSOR");

            statement.executeUpdate();
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to save CPR session summary " + summary.id(), error);
        }
    }

    public List<CprSessionSummaryResponse> findCprSessions(CprSessionSummaryQueryRequest query) {
        StringBuilder sql = new StringBuilder("SELECT * FROM cpr_session_summaries WHERE 1=1");
        List<Object> params = new ArrayList<>();

        if (query != null) {
            if (hasText(query.userId())) {
                sql.append(" AND (LOWER(user_id) = LOWER(?) OR LOWER(trainee_id) = LOWER(?))");
                params.add(query.userId().trim());
                params.add(query.userId().trim());
            }
            if (hasText(query.manikinId())) {
                sql.append(" AND LOWER(device_id) = LOWER(?)");
                params.add(query.manikinId().trim());
            }

            Instant fromInstant = parseOptionalInstant(query.from(), "from");
            Instant toInstant = parseOptionalInstant(query.to(), "to");

            if (fromInstant != null) {
                sql.append(" AND started_at >= ?");
                params.add(fromInstant.toString());
            }
            if (toInstant != null) {
                sql.append(" AND started_at <= ?");
                params.add(toInstant.toString());
            }
        }

        sql.append(" ORDER BY started_at DESC");

        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement(sql.toString())) {
            for (int i = 0; i < params.size(); i++) {
                statement.setObject(i + 1, params.get(i));
            }

            List<CprSessionSummaryResponse> results = new ArrayList<>();
            try (ResultSet resultSet = statement.executeQuery()) {
                while (resultSet.next()) {
                    results.add(mapCprSession(resultSet));
                }
            }
            return results;
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to query CPR session summaries", error);
        }
    }

    public Optional<CprSessionSummaryResponse> findCprSessionById(String sessionId) {
        if (!hasText(sessionId)) {
            return Optional.empty();
        }

        String sql = "SELECT * FROM cpr_session_summaries WHERE session_id = ?";
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, sessionId.trim());
            try (ResultSet resultSet = statement.executeQuery()) {
                if (resultSet.next()) {
                    return Optional.of(mapCprSession(resultSet));
                }
            }
            return Optional.empty();
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to load CPR session summary for session " + sessionId, error);
        }
    }

    public long countCprSessions() {
        String sql = "SELECT COUNT(*) FROM cpr_session_summaries";
        try (Connection connection = openConnection(); Statement statement = connection.createStatement(); ResultSet resultSet = statement.executeQuery(sql)) {
            if (resultSet.next()) {
                return resultSet.getLong(1);
            }
            return 0L;
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to count CPR session summaries", error);
        }
    }

    private Connection openConnection() throws SQLException {
        return DriverManager.getConnection(jdbcUrl);
    }

    private static CprSessionSummaryResponse mapCprSession(ResultSet resultSet) throws SQLException {
        String ds = resultSet.getString("data_source");
        if (ds == null || ds.isBlank()) {
            ds = "REAL_SENSOR";
        }
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
                parseInstant(resultSet.getString("created_at")),
                ds
        );
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private static Instant parseInstant(String value) {
        return value == null ? null : Instant.parse(value);
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
        if (hasText(first)) return first.trim();
        if (hasText(second)) return second.trim();
        return null;
    }
}
