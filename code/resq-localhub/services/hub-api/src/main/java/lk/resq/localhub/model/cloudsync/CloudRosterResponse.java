package lk.resq.localhub.model.cloudsync;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;
import java.util.List;

/**
 * Top-level response from GET /api/sync/roster on the Cloud API.
 *
 * <p>Fields match exactly the camelCase JSON produced by {@code CloudRosterResponse}
 * on the cloud side. Unknown fields are ignored so the hub tolerates cloud-side
 * additions without breaking.</p>
 */
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonInclude(JsonInclude.Include.NON_NULL)
public record CloudRosterResponse(
        String hubId,
        Instant generatedAt,
        List<CloudRosterUser> users,
        List<CloudRosterCourse> courses,
        List<CloudRosterInstructorAssignment> instructorAssignments,
        List<CloudRosterEnrollment> enrollments
) {
}
