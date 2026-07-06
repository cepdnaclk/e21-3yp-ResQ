package lk.resq.localhub.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import lk.resq.localhub.model.cpr.CprSessionSummaryQueryRequest;
import lk.resq.localhub.model.cpr.CprSessionSummaryResponse;

class CprSampleDataSeederTest {

    private Path tempDbPath;
    private LocalSessionRepository sessionRepository;

    @BeforeEach
    void setUp() throws IOException {
        tempDbPath = Files.createTempFile("cpr-seeder-test-", ".sqlite");
        sessionRepository = new LocalSessionRepository(tempDbPath.toString());
        sessionRepository.initialize();
    }

    @AfterEach
    void tearDown() throws IOException {
        Files.deleteIfExists(tempDbPath);
    }

    @Test
    void doesNotSeedWhenDisabled() {
        CprSampleDataSeeder seeder = new CprSampleDataSeeder(sessionRepository, false);
        seeder.seed();

        CprSessionSummaryQueryRequest query = new CprSessionSummaryQueryRequest(null, null, null, null, null);
        List<CprSessionSummaryResponse> sessions = sessionRepository.findCprSessions(query);
        assertThat(sessions).isEmpty();
    }

    @Test
    void seedsSessionsWhenEnabledAndDatabaseIsEmpty() {
        CprSampleDataSeeder seeder = new CprSampleDataSeeder(sessionRepository, true);
        seeder.seed();

        CprSessionSummaryQueryRequest query = new CprSessionSummaryQueryRequest(null, null, null, null, null);
        List<CprSessionSummaryResponse> sessions = sessionRepository.findCprSessions(query);
        
        assertThat(sessions).hasSize(14);

        // Idempotence test: seeding again shouldn't duplicate
        seeder.seed();
        sessions = sessionRepository.findCprSessions(query);
        assertThat(sessions).hasSize(14);
    }
}
