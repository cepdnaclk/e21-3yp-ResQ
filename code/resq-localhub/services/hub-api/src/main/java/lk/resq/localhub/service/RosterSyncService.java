package lk.resq.localhub.service;

import lk.resq.localhub.model.cloudsync.CloudRosterResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Instant;

/**
 * Service to manage syncing the cloud-master roster into the LocalHub SQLite cache.
 */
@Service
public class RosterSyncService {

    private static final Logger logger = LoggerFactory.getLogger(RosterSyncService.class);

    private final RosterSyncClient rosterSyncClient;
    private final RosterCacheRepository rosterCacheRepository;

    public RosterSyncService(
            RosterSyncClient rosterSyncClient,
            RosterCacheRepository rosterCacheRepository
    ) {
        this.rosterSyncClient = rosterSyncClient;
        this.rosterCacheRepository = rosterCacheRepository;
    }

    /**
     * Triggers a roster sync pull from the cloud API and caches the results.
     * Updates the roster sync state in the repository.
     *
     * @return The pulled CloudRosterResponse on success.
     * @throws Exception if the sync process fails.
     */
    public CloudRosterResponse syncRoster() throws Exception {
        Instant attemptAt = Instant.now();
        logger.info("Starting manual/scheduled roster sync pull...");
        rosterCacheRepository.recordAttempt(attemptAt);

        try {
            CloudRosterResponse response = rosterSyncClient.pullRoster();
            Instant successAt = Instant.now();

            int userCount = response.users() != null ? response.users().size() : 0;
            int courseCount = response.courses() != null ? response.courses().size() : 0;
            int enrollmentCount = response.enrollments() != null ? response.enrollments().size() : 0;
            int assignmentCount = response.instructorAssignments() != null ? response.instructorAssignments().size() : 0;

            logger.info("Roster response pulled successfully. Parsing and caching: {} users, {} courses, {} instructor assignments, {} enrollments",
                    userCount, courseCount, assignmentCount, enrollmentCount);

            if (response.users() != null) {
                for (var user : response.users()) {
                    rosterCacheRepository.upsertUser(user, successAt);
                }
            }

            if (response.courses() != null) {
                for (var course : response.courses()) {
                    rosterCacheRepository.upsertCourse(course, successAt);
                }
            }

            if (response.instructorAssignments() != null) {
                for (var assignment : response.instructorAssignments()) {
                    rosterCacheRepository.upsertInstructorAssignment(assignment, successAt);
                }
            }

            if (response.enrollments() != null) {
                for (var enrollment : response.enrollments()) {
                    rosterCacheRepository.upsertEnrollment(enrollment, successAt);
                }
            }

            rosterCacheRepository.recordSuccess(successAt, userCount, courseCount, enrollmentCount);
            logger.info("Roster sync completed successfully.");

            return response;
        } catch (Exception error) {
            logger.error("Roster sync failed: {}", error.getMessage());
            rosterCacheRepository.recordFailure(attemptAt, error.getMessage());
            throw error;
        }
    }
}
