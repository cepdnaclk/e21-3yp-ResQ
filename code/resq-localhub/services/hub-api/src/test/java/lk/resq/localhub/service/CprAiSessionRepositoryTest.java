package lk.resq.localhub.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import lk.resq.localhub.model.cpr.CprSessionSummaryQueryRequest;
import lk.resq.localhub.model.cpr.CprSessionSummaryResponse;

class CprAiSessionRepositoryTest {

    private Path tempDbPath;
    private CprAiSessionRepository repository;

    @BeforeEach
    void setUp() throws IOException {
        tempDbPath = Files.createTempFile("cpr-ai-repo-test-", ".sqlite");
        repository = new CprAiSessionRepository(tempDbPath.toString());
        repository.initialize();
    }

    @AfterEach
    void tearDown() throws IOException {
        Files.deleteIfExists(tempDbPath);
    }

    @Test
    void saveAndQueryCprSessionSummary() {
        Instant now = Instant.now();
        CprSessionSummaryResponse summary = new CprSessionSummaryResponse(
                "session-cpr-1",
                "user-1",
                "trainee-1",
                "manikin-1",
                now,
                now.plusSeconds(60),
                60L,
                52.0,
                48.0,
                56.0,
                85.0,
                110.0,
                90.0,
                5.0,
                1,
                2.0,
                88.0,
                3.0,
                92,
                now,
                "REAL_SENSOR"
        );

        repository.saveCprSession(summary);

        CprSessionSummaryResponse loaded = repository.findCprSessionById("session-cpr-1").orElseThrow();
        assertThat(loaded.id()).isEqualTo("session-cpr-1");
        assertThat(loaded.userId()).isEqualTo("user-1");
        assertThat(loaded.avgDepthMm()).isEqualTo(52.0);
        assertThat(loaded.overallScore()).isEqualTo(92);

        CprSessionSummaryQueryRequest query = new CprSessionSummaryQueryRequest("user-1", null, null, null, null);
        List<CprSessionSummaryResponse> userSessions = repository.findCprSessions(query);
        assertThat(userSessions).hasSize(1);
    }
}
