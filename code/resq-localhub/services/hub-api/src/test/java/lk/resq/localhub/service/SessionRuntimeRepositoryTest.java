package lk.resq.localhub.service;

import lk.resq.localhub.model.DurableSessionRuntimeRecord;
import lk.resq.localhub.model.SessionLifecycleState;
import lk.resq.localhub.model.SessionRecoveryStatus;
import org.junit.jupiter.api.Test;

import java.nio.file.Path;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class SessionRuntimeRepositoryTest {

    @Test
    void initializeIsRepeatable() {
        SessionRuntimeRepository repository = newRepository();

        repository.initialize();
        repository.initialize();

        assertThat(repository.findRecoverable()).isEmpty();
    }

    @Test
    void roundTripsImportantFieldsAndPhaseFiveRequestIds() {
        SessionRuntimeRepository repository = newRepository();
        Instant now = Instant.parse("2026-07-13T12:00:00Z");
        DurableSessionRuntimeRecord record = new DurableSessionRuntimeRecord(
                "session-1",
                "M01",
                "trainee-1",
                "adult-basic",
                "assessment",
                "notes",
                "course-1",
                "instructor-1",
                SessionLifecycleState.STOP_PENDING,
                true,
                now,
                now.plusSeconds(4),
                null,
                "req-300-a4f18d2c-000001",
                now,
                now.plusSeconds(7),
                "req-301-a4f18d2c-000002",
                now.plusSeconds(4),
                now.plusSeconds(11),
                "waiting",
                "00000",
                0,
                42L,
                "{\"sampleCount\":3}",
                false,
                true,
                SessionRecoveryStatus.PENDING,
                now.plusSeconds(5),
                now.plusSeconds(20),
                "RECOVERING_SESSION_STATE"
        );

        repository.upsert(record);

        DurableSessionRuntimeRecord loaded = repository.findBySessionId("session-1").orElseThrow();
        assertThat(loaded).isEqualTo(record);
        assertThat(loaded.startRequestId()).isEqualTo("req-300-a4f18d2c-000001");
        assertThat(loaded.stopRequestId()).isEqualTo("req-301-a4f18d2c-000002");
        assertThat(loaded.accumulatorSnapshotJson()).contains("sampleCount");
    }

    @Test
    void recoverableQueryIncludesOnlyRuntimeRecoveryStates() {
        SessionRuntimeRepository repository = newRepository();
        Instant now = Instant.parse("2026-07-13T12:00:00Z");
        repository.upsert(record("start", SessionLifecycleState.START_PENDING, now));
        repository.upsert(record("active", SessionLifecycleState.ACTIVE, now));
        repository.upsert(record("stop", SessionLifecycleState.STOP_PENDING, now));
        repository.upsert(record("completed", SessionLifecycleState.COMPLETED, now));

        assertThat(repository.findRecoverable())
                .extracting(DurableSessionRuntimeRecord::sessionId)
                .contains("start", "active", "stop")
                .doesNotContain("completed");
    }

    private static DurableSessionRuntimeRecord record(String sessionId, SessionLifecycleState state, Instant now) {
        return new DurableSessionRuntimeRecord(
                sessionId,
                "M-" + sessionId,
                null,
                "adult-basic",
                null,
                null,
                null,
                null,
                state,
                state == SessionLifecycleState.ACTIVE || state == SessionLifecycleState.STOP_PENDING,
                now,
                now,
                null,
                "req-300-a4f18d2c-" + sessionId,
                now,
                now.plusSeconds(7),
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                "{}",
                false,
                false,
                SessionRecoveryStatus.NONE,
                null,
                null,
                null
        );
    }

    private static SessionRuntimeRepository newRepository() {
        SessionRuntimeRepository repository = new SessionRuntimeRepository(
                Path.of("target", "session-runtime-" + UUID.randomUUID() + ".sqlite").toString()
        );
        repository.initialize();
        return repository;
    }
}
