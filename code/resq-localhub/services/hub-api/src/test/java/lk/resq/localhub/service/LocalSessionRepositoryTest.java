package lk.resq.localhub.service;

import lk.resq.localhub.model.SessionEndResponse;
import lk.resq.localhub.model.SessionSummary;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

class LocalSessionRepositoryTest {

    @TempDir
    Path tempDir;

    @Test
    void migratesLegacyNotNullEvidenceAndPersistsUnavailableModerateV1Summary() throws Exception {
        Path database = tempDir.resolve("sessions.sqlite");
        String jdbcUrl = "jdbc:sqlite:" + database.toString().replace("\\", "/");
        createLegacySchema(jdbcUrl);

        LocalSessionRepository repository = new LocalSessionRepository(database.toString());
        repository.initialize();

        Instant startedAt = Instant.parse("2026-08-02T10:00:00Z");
        Instant endedAt = startedAt.plusSeconds(1);
        SessionSummary unavailable = new SessionSummary(
                "S-unavailable", "M01", "T01", startedAt, endedAt,
                1, 7, 0, 0,
                null, null, null, null,
                0, 0, 0, 0, null,
                "moderate-v1", null, "Unavailable",
                null, null, null, null, null,
                null, "required scoring evidence is unavailable", true, 0,
                null, null, "Collect valid scoring evidence.",
                "50-60 mm", "100-120 cpm", ">=90%", ">=90%", ">=80%"
        );
        repository.save(new SessionEndResponse(
                "S-unavailable", "M01", "T01", startedAt, true, endedAt,
                "Immediate stop", null, unavailable, "C01", "I01"
        ));

        SessionSummary persisted = repository.findById("S-unavailable").orElseThrow().summary();
        assertThat(persisted.scoringVersion()).isEqualTo("moderate-v1");
        assertThat(persisted.overallScore()).isNull();
        assertThat(persisted.grade()).isEqualTo("Unavailable");
        assertThat(persisted.scoreProvisional()).isTrue();
        assertThat(persisted.scoreCapReason()).isEqualTo("required scoring evidence is unavailable");
        assertThat(persisted.avgDepthMm()).isNull();
        assertThat(persisted.avgRateCpm()).isNull();
        assertThat(persisted.recoilPct()).isNull();

        try (Connection connection = DriverManager.getConnection(jdbcUrl);
             Statement statement = connection.createStatement();
             ResultSet columns = statement.executeQuery("PRAGMA table_info(session_metrics)")) {
            int nullableEvidenceColumns = 0;
            while (columns.next()) {
                String name = columns.getString("name");
                if ("avg_depth_mm".equals(name) || "avg_rate_cpm".equals(name) || "recoil_pct".equals(name)) {
                    assertThat(columns.getInt("notnull")).isZero();
                    nullableEvidenceColumns++;
                }
            }
            assertThat(nullableEvidenceColumns).isEqualTo(3);
        }
    }

    private static void createLegacySchema(String jdbcUrl) throws Exception {
        try (Connection connection = DriverManager.getConnection(jdbcUrl);
             Statement statement = connection.createStatement()) {
            statement.executeUpdate("""
                    CREATE TABLE sessions (
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
                    CREATE TABLE session_metrics (
                      session_id TEXT PRIMARY KEY,
                      sample_count INTEGER NOT NULL DEFAULT 0,
                      total_compressions INTEGER NOT NULL DEFAULT 0,
                      valid_compressions INTEGER NOT NULL DEFAULT 0,
                      duration_seconds INTEGER NOT NULL,
                      avg_depth_mm REAL NOT NULL,
                      avg_depth_progress REAL,
                      avg_rate_cpm REAL NOT NULL,
                      recoil_pct REAL NOT NULL,
                      recoil_ok_count INTEGER NOT NULL DEFAULT 0,
                      incomplete_recoil_count INTEGER NOT NULL DEFAULT 0,
                      pauses_count INTEGER NOT NULL,
                      score INTEGER NOT NULL,
                      latest_flags TEXT,
                      scoring_details TEXT,
                      FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
                    )
                    """);
        }
    }
}
