package lk.resq.cloudapi.repository;

import lk.resq.cloudapi.model.CloudHubApiKey;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * Repository for hub API key management and roster data access.
 */
public interface CloudHubRepository {

    /** Look up a hub entry by hub_id. Returns empty if not found or not active. */
    Optional<CloudHubApiKey> findActiveHubById(String hubId);

    /** Record the last_used_at timestamp after a successful authentication. */
    void updateLastUsed(String hubId, Instant lastUsedAt);

    /**
     * Return the list of course_ids assigned to this hub in cloud_hub_course_assignments
     * where active = true. Returns an empty list when the hub has no assignments (open access).
     */
    List<String> findActiveCourseIdsByHubId(String hubId);
}
