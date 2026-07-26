package lk.resq.localhub.service;

import java.nio.file.Path;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import org.junit.jupiter.api.Test;

import lk.resq.localhub.model.SessionEndResponse;
import lk.resq.localhub.model.SessionSummary;

class LocalSessionRepositoryTest {

    @Test
    void saveAndLoadPersistsExtendedCprSummaryFields() {
        LocalSessionRepository repository = newRepository();
        Instant startedAt = Instant.parse("2026-06-08T08:00:00Z");
        Instant endedAt = Instant.parse("2026-06-08T08:01:10Z");

        SessionSummary summary = new SessionSummary(
                "session-1",
                "M01",
                "trainee-1",
                startedAt,
                endedAt,
                70,
                12,
                10,
                9,
                52.4,
                0.84,
                111.2,
                88.5,
                8,
                1,
                3,
                91,
                "DEPTH_OK,RATE_OK",
                48.0,
                56.5,
                75.0,
                82.0,
                11.5,
                4.2,
                86.0,
                7.5
        );

        repository.save(new SessionEndResponse(
                summary.sessionId(),
                summary.deviceId(),
                summary.traineeId(),
                startedAt,
                true,
                endedAt,
                "adult-cpr",
                "Notes",
                summary,
                "course-1",
                "instructor-1"
        ));

        SessionEndResponse loaded = repository.findById("session-1").orElseThrow();
        assertThat(loaded.summary().minDepthMm()).isEqualTo(48.0);
        assertThat(loaded.summary().maxDepthMm()).isEqualTo(56.5);
        assertThat(loaded.summary().depthAccuracyPercent()).isEqualTo(75.0);
        assertThat(loaded.summary().rateAccuracyPercent()).isEqualTo(82.0);
        assertThat(loaded.summary().recoilErrorPercent()).isEqualTo(11.5);
        assertThat(loaded.summary().longestPauseSeconds()).isEqualTo(4.2);
        assertThat(loaded.summary().consistencyScore()).isEqualTo(86.0);
        assertThat(loaded.summary().fatigueDropPercent()).isEqualTo(7.5);
        assertThat(loaded.summary().overallScore()).isEqualTo(91);
        assertThat(loaded.summary().pauseCount()).isEqualTo(3);
    }

    @Test
    void sessionSummaryValidationRejectsInvalidRanges() {
        Instant startedAt = Instant.parse("2026-06-08T08:00:00Z");
        Instant endedAt = Instant.parse("2026-06-08T08:00:30Z");

        assertThatThrownBy(() -> new SessionSummary(
                "session-2",
                "M01",
                "trainee-1",
                startedAt,
                endedAt,
                0,
                1,
                1,
                1,
                50.0,
                0.8,
                110.0,
                90.0,
                1,
                0,
                0,
                90,
                "DEPTH_OK",
                49.0,
                54.0,
                101.0,
                90.0,
                10.0,
                1.0,
                88.0,
                5.0
        )).isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("durationSeconds");

        assertThatThrownBy(() -> new SessionSummary(
                "session-3",
                "M01",
                "trainee-1",
                startedAt,
                endedAt,
                30,
                1,
                1,
                1,
                50.0,
                0.8,
                110.0,
                90.0,
                1,
                0,
                0,
                90,
                "DEPTH_OK",
                49.0,
                54.0,
                75.0,
                90.0,
                10.0,
                1.0,
                88.0,
                105.0
        )).isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("fatigueDropPercent");
    }

    @Test
    void filtersOutSeededSessionsWhenNotDevOrTest() {
        org.springframework.core.env.Environment env = org.mockito.Mockito.mock(org.springframework.core.env.Environment.class);
        org.mockito.Mockito.when(env.acceptsProfiles(org.mockito.Mockito.any(org.springframework.core.env.Profiles.class))).thenReturn(false);

        String dbPath = Path.of("target", "local-session-repository-test-prod-" + UUID.randomUUID() + ".sqlite").toString();
        LocalSessionRepository repository = new LocalSessionRepository(dbPath, env);
        repository.initialize();

        Instant startedAt = Instant.parse("2026-06-08T08:00:00Z");
        Instant endedAt = Instant.parse("2026-06-08T08:01:10Z");

        SessionSummary summarySeed = new SessionSummary(
                "session-seed", "M01", "trainee-1", startedAt, endedAt, 70, 12, 10, 9, 52.4, 0.84, 111.2, 88.5, 8, 1, 3, 91, "DEPTH_OK",
                48.0, 56.5, 75.0, 82.0, 11.5, 4.2, 86.0, 7.5
        );
        SessionSummary summaryReal = new SessionSummary(
                "session-real", "M01", "trainee-1", startedAt, endedAt, 70, 12, 10, 9, 52.4, 0.84, 111.2, 88.5, 8, 1, 3, 91, "DEPTH_OK",
                48.0, 56.5, 75.0, 82.0, 11.5, 4.2, 86.0, 7.5
        );

        repository.save(new SessionEndResponse(
                summarySeed.sessionId(), summarySeed.deviceId(), summarySeed.traineeId(),
                startedAt, true, endedAt, "adult-cpr", "Notes", summarySeed,
                "course-1", "instructor-1", "DEV_SEED"
        ));

        repository.save(new SessionEndResponse(
                summaryReal.sessionId(), summaryReal.deviceId(), summaryReal.traineeId(),
                startedAt, true, endedAt, "adult-cpr", "Notes", summaryReal,
                "course-1", "instructor-1", "REAL_SENSOR"
        ));

        assertThat(repository.findById("session-seed")).isEmpty();
        assertThat(repository.findById("session-real")).isPresent();

        assertThat(repository.findAll()).hasSize(1);
        assertThat(repository.findAll().get(0).sessionId()).isEqualTo("session-real");

        assertThat(repository.findCprSessionById("session-seed")).isEmpty();
        assertThat(repository.findCprSessionById("session-real")).isPresent();

        lk.resq.localhub.model.cpr.CprSessionSummaryQueryRequest query = 
            new lk.resq.localhub.model.cpr.CprSessionSummaryQueryRequest(null, null, null, null, null);
        assertThat(repository.findCprSessions(query)).hasSize(1);
        assertThat(repository.findCprSessions(query).get(0).id()).isEqualTo("session-real");
    }

    private static LocalSessionRepository newRepository() {
        LocalSessionRepository repository = new LocalSessionRepository(
                Path.of("target", "local-session-repository-test-" + UUID.randomUUID() + ".sqlite").toString()
        );
        repository.initialize();
        return repository;
    }
}