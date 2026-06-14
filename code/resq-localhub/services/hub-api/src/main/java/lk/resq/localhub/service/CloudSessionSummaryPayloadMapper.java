package lk.resq.localhub.service;

import lk.resq.localhub.model.SessionEndResponse;
import lk.resq.localhub.model.SessionSummary;
import lk.resq.localhub.model.cloudsync.CloudSessionSummarySyncPayload;
import lk.resq.localhub.model.cloudsync.CloudSyncContractVersion;
import lk.resq.localhub.model.cloudsync.CloudSyncEntityType;
import org.springframework.stereotype.Component;

import java.time.Instant;

@Component
public class CloudSessionSummaryPayloadMapper {

    private final RosterCacheRepository rosterCacheRepository;
    private static final java.util.Set<String> ALLOWED_ROLES = java.util.Set.of("INSTRUCTOR", "ADMIN");

    @org.springframework.beans.factory.annotation.Autowired
    public CloudSessionSummaryPayloadMapper(RosterCacheRepository rosterCacheRepository) {
        this.rosterCacheRepository = rosterCacheRepository;
    }

    public CloudSessionSummaryPayloadMapper() {
        this.rosterCacheRepository = null;
    }

    public CloudSessionSummarySyncPayload map(SessionEndResponse session, Instant generatedAt) {
        SessionSummary summary = session.summary();
        Instant startedAt = session.startedAt() != null
                ? session.startedAt()
                : summary == null ? null : summary.startedAt();
        Instant endedAt = session.endedAt() != null
                ? session.endedAt()
                : summary == null ? null : summary.endedAt();

        String courseId = session.courseId();
        String instructorId = session.instructorId();
        if (courseId != null && !courseId.isBlank()) {
            if (rosterCacheRepository != null) {
                boolean currentValid = false;
                if (instructorId != null && !instructorId.isBlank()) {
                    if (rosterCacheRepository.existsActiveCloudUser(instructorId, ALLOWED_ROLES)
                            && rosterCacheRepository.isInstructorAssignedToCourse(courseId, instructorId)) {
                        currentValid = true;
                    }
                }
                if (!currentValid) {
                    java.util.Optional<String> primaryOpt = rosterCacheRepository.findPrimaryInstructorForCourse(courseId);
                    if (primaryOpt.isPresent() && rosterCacheRepository.existsActiveCloudUser(primaryOpt.get(), ALLOWED_ROLES)) {
                        instructorId = primaryOpt.get();
                    } else {
                        java.util.List<lk.resq.localhub.model.roster.CourseInstructorView> list = rosterCacheRepository.listInstructorsForCourse(courseId);
                        if (!list.isEmpty()) {
                            instructorId = list.get(0).cloudUserId();
                        }
                    }
                }
            }
        }

        return new CloudSessionSummarySyncPayload(
                CloudSyncContractVersion.CURRENT,
                CloudSyncEntityType.SESSION_SUMMARY,
                null,
                session.sessionId(),
                null,
                session.deviceId(),
                null,
                session.traineeId(),
                instructorId,
                courseId,
                startedAt,
                endedAt,
                durationMs(summary),
                session.ended() ? "COMPLETED" : "ACTIVE",
                session.ended() ? "COMPLETED" : "UNKNOWN",
                summary == null ? null : summary.totalCompressions(),
                summary == null ? null : summary.validCompressions(),
                summary == null ? null : summary.avgDepthMm(),
                summary == null ? null : summary.avgRateCpm(),
                summary == null ? null : summary.recoilPct(),
                summary == null ? null : summary.recoilOkCount(),
                summary == null ? null : summary.incompleteRecoilCount(),
                summary == null ? null : summary.pausesCount(),
                summary == null ? null : summary.score(),
                summary == null ? null : summary.latestFlags(),
                session.notes(),
                session.scenario(),
                "LOCALHUB",
                generatedAt
        );
    }

    private static Long durationMs(SessionSummary summary) {
        if (summary == null) {
            return null;
        }
        return Math.multiplyExact(summary.durationSeconds(), 1_000L);
    }
}
