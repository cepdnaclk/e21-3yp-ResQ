package lk.resq.localhub.service;

import lk.resq.localhub.model.SessionEndResponse;
import lk.resq.localhub.model.SessionSummary;
import lk.resq.localhub.model.cloudsync.CloudSyncContractVersion;
import lk.resq.localhub.model.cloudsync.CloudSyncEntityType;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

class CloudSessionSummaryPayloadMapperTest {

    private final CloudSessionSummaryPayloadMapper mapper = new CloudSessionSummaryPayloadMapper();

    @Test
    void mapsCompletedSessionToVersionedCloudContract() {
        Instant startedAt = Instant.parse("2026-06-08T08:00:00Z");
        Instant endedAt = Instant.parse("2026-06-08T08:01:30Z");
        Instant generatedAt = Instant.parse("2026-06-08T08:01:31Z");
        SessionSummary summary = new SessionSummary(
                "S-100",
                "M01",
                "trainee-1",
                startedAt,
                endedAt,
                90,
                45,
                40,
                36,
                51.5,
                0.82,
                108.0,
                95.0,
                38,
                2,
                1,
                92,
                "DEPTH_OK,RATE_OK"
        );
        SessionEndResponse response = new SessionEndResponse(
                "S-100",
                "M01",
                "trainee-1",
                startedAt,
                true,
                endedAt,
                "adult-cpr",
                "Strong overall attempt",
                summary
        );

        var payload = mapper.map(response, generatedAt);

        assertThat(payload.contractVersion()).isEqualTo(CloudSyncContractVersion.CURRENT);
        assertThat(payload.entityType()).isEqualTo(CloudSyncEntityType.SESSION_SUMMARY);
        assertThat(payload.localSessionId()).isEqualTo("S-100");
        assertThat(payload.sessionId()).isNull();
        assertThat(payload.durationMs()).isEqualTo(90_000L);
        assertThat(payload.pauseCount()).isEqualTo(1);
        assertThat(payload.source()).isEqualTo("LOCALHUB");
        assertThat(payload.generatedAt()).isEqualTo(generatedAt);
        assertThat(payload.courseId()).isNull();
    }

    @Test
    void mapsCompletedSessionWithCourseIdToVersionedCloudContract() {
        Instant startedAt = Instant.parse("2026-06-08T08:00:00Z");
        Instant endedAt = Instant.parse("2026-06-08T08:01:30Z");
        Instant generatedAt = Instant.parse("2026-06-08T08:01:31Z");
        SessionSummary summary = new SessionSummary(
                "S-100",
                "M01",
                "trainee-1",
                startedAt,
                endedAt,
                90,
                45,
                40,
                36,
                51.5,
                0.82,
                108.0,
                95.0,
                38,
                2,
                1,
                92,
                "DEPTH_OK,RATE_OK"
        );
        SessionEndResponse response = new SessionEndResponse(
                "S-100",
                "M01",
                "trainee-1",
                startedAt,
                true,
                endedAt,
                "adult-cpr",
                "Strong overall attempt",
                summary,
                "course-123",
                "instructor-456"
        );

        var payload = mapper.map(response, generatedAt);

        assertThat(payload.contractVersion()).isEqualTo(CloudSyncContractVersion.CURRENT);
        assertThat(payload.entityType()).isEqualTo(CloudSyncEntityType.SESSION_SUMMARY);
        assertThat(payload.localSessionId()).isEqualTo("S-100");
        assertThat(payload.courseId()).isEqualTo("course-123");
        assertThat(payload.traineeId()).isEqualTo("trainee-1");
        assertThat(payload.instructorId()).isEqualTo("instructor-456");
        assertThat(payload.generatedAt()).isEqualTo(generatedAt);
    }

    private static class StubRosterCacheRepository extends RosterCacheRepository {
        public StubRosterCacheRepository() {
            super("target/stub-roster-cache.sqlite");
        }
        @Override public void initialize() {}
        @Override public synchronized boolean existsActiveCloudUser(String id, java.util.Set<String> roles) {
            return "primary-instructor-uuid".equals(id);
        }
        @Override public synchronized java.util.Optional<String> findPrimaryInstructorForCourse(String courseId) {
            return java.util.Optional.of("primary-instructor-uuid");
        }
        @Override public synchronized boolean isInstructorAssignedToCourse(String courseId, String instructorId) {
            return false;
        }
    }

    @Test
    void mapsSessionWithCourseIdAndDerivesInstructorFromRosterCache() {
        StubRosterCacheRepository repo = new StubRosterCacheRepository();
        CloudSessionSummaryPayloadMapper mapperWithRepo = new CloudSessionSummaryPayloadMapper(repo);

        Instant startedAt = Instant.parse("2026-06-08T08:00:00Z");
        Instant endedAt = Instant.parse("2026-06-08T08:01:30Z");
        Instant generatedAt = Instant.parse("2026-06-08T08:01:31Z");
        SessionEndResponse response = new SessionEndResponse(
                "S-100",
                "M01",
                "trainee-1",
                startedAt,
                true,
                endedAt,
                "adult-cpr",
                "Strong overall attempt",
                null,
                "course-123",
                "instructor-from-session"
        );

        var payload = mapperWithRepo.map(response, generatedAt);

        assertThat(payload.courseId()).isEqualTo("course-123");
        assertThat(payload.instructorId()).isEqualTo("primary-instructor-uuid");
    }
}
