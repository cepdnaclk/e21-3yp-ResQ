package lk.resq.cloudapi.model;

import java.time.Instant;
import java.util.List;

/**
 * Top-level roster response returned by GET /api/sync/roster.
 *
 * <p>Field semantics:</p>
 * <ul>
 *   <li>{@code hubId}               – the hub that requested the roster</li>
 *   <li>{@code generatedAt}         – server-side timestamp at which the snapshot was taken</li>
 *   <li>{@code users}               – all relevant cloud users (no password hashes)</li>
 *   <li>{@code courses}             – all relevant active courses</li>
 *   <li>{@code instructorAssignments} – instructor-to-course links</li>
 *   <li>{@code enrollments}         – active trainee enrollments</li>
 * </ul>
 */
public record CloudRosterResponse(
        String hubId,
        Instant generatedAt,
        List<CloudRosterUser> users,
        List<CloudRosterCourse> courses,
        List<CloudRosterInstructorAssignment> instructorAssignments,
        List<CloudRosterEnrollment> enrollments
) {
}
