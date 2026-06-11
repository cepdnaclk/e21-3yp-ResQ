package lk.resq.cloudapi.service;

import lk.resq.cloudapi.model.CloudCourse;
import lk.resq.cloudapi.model.CloudEnrollment;
import lk.resq.cloudapi.model.CloudRosterCourse;
import lk.resq.cloudapi.model.CloudRosterEnrollment;
import lk.resq.cloudapi.model.CloudRosterInstructorAssignment;
import lk.resq.cloudapi.model.CloudRosterResponse;
import lk.resq.cloudapi.model.CloudRosterUser;
import lk.resq.cloudapi.model.CloudUser;
import lk.resq.cloudapi.repository.CloudHubRepository;
import lk.resq.cloudapi.repository.CloudManagementRepository;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Builds the cloud-master roster snapshot for a given LocalHub.
 *
 * <h2>Course scoping</h2>
 * <ul>
 *   <li>If the hub has <em>active rows</em> in {@code cloud_hub_course_assignments},
 *       only those courses (and their users/enrollments) are returned.</li>
 *   <li>If the hub has <em>no assignment rows</em>, <strong>all</strong> active
 *       courses/users/enrollments are returned.
 *       <br><em>MVP/dev behaviour — acceptable for now. When production multi-tenancy
 *       is needed, make assignment rows mandatory and remove this fallback.</em></li>
 * </ul>
 */
@Service
public class CloudRosterSyncService {

    private final CloudHubRepository        hubRepository;
    private final CloudManagementRepository managementRepository;

    public CloudRosterSyncService(
            CloudHubRepository        hubRepository,
            CloudManagementRepository managementRepository
    ) {
        this.hubRepository        = hubRepository;
        this.managementRepository = managementRepository;
    }

    /**
     * Build the full roster snapshot for the given hub.
     *
     * @param hubId the authenticated hub id (already validated by the filter)
     * @return a complete {@link CloudRosterResponse}
     */
    public CloudRosterResponse buildRoster(String hubId) {
        Instant generatedAt = Instant.now();

        // 1. Determine which courses to include.
        List<String> assignedCourseIds = hubRepository.findActiveCourseIdsByHubId(hubId);
        boolean scoped = !assignedCourseIds.isEmpty();

        List<CloudCourse> courses = managementRepository.findAllCourses().stream()
                .filter(c -> c.active())
                .filter(c -> !scoped || assignedCourseIds.contains(c.courseId()))
                .collect(Collectors.toList());

        Set<String> courseIds = courses.stream()
                .map(CloudCourse::courseId)
                .collect(Collectors.toSet());

        // 2. Collect users: all users visible to the hub.
        //    We collect all users and then filter to only those referenced by
        //    selected courses (instructors) or enrollments (trainees + instructors).
        //    For simplicity we pull all users and filter in-memory — the table is
        //    small enough for MVP. Replace with a targeted query if it grows large.
        List<CloudUser> allUsers = managementRepository.findAllUsers();

        // 3. Collect enrollments for the scoped courses.
        List<CloudEnrollment> enrollments = new ArrayList<>();
        for (String courseId : courseIds) {
            enrollments.addAll(managementRepository.findCourseEnrollments(courseId));
        }
        // Only active enrollments in the snapshot.
        enrollments = enrollments.stream()
                .filter(CloudEnrollment::active)
                .collect(Collectors.toList());

        // 4. Build the set of user-ids we actually need to include.
        Set<String> relevantUserIds = new HashSet<>();
        // Instructors referenced by courses.
        for (CloudCourse course : courses) {
            if (course.instructorId() != null) {
                relevantUserIds.add(course.instructorId());
            }
        }
        // Trainees in enrollments.
        for (CloudEnrollment enrollment : enrollments) {
            relevantUserIds.add(enrollment.traineeId());
        }

        // 5. Map to DTOs — exclude password_hash (intentionally not in CloudUser record).
        List<CloudRosterUser> rosterUsers = allUsers.stream()
                .filter(u -> relevantUserIds.contains(u.userId()))
                .map(u -> new CloudRosterUser(
                        u.userId(),
                        u.displayName(),
                        u.email(),
                        u.role().name(),
                        u.active(),
                        u.updatedAt()
                ))
                .collect(Collectors.toList());

        List<CloudRosterCourse> rosterCourses = courses.stream()
                .map(c -> new CloudRosterCourse(
                        c.courseId(),
                        c.courseCode(),
                        c.title(),
                        c.description(),
                        c.instructorId(),
                        c.active(),
                        c.updatedAt()
                ))
                .collect(Collectors.toList());

        // Instructor assignments derived from courses with a non-null instructorId.
        List<CloudRosterInstructorAssignment> instructorAssignments = courses.stream()
                .filter(c -> c.instructorId() != null)
                .map(c -> new CloudRosterInstructorAssignment(
                        c.courseId(),
                        c.instructorId(),
                        c.active()
                ))
                .collect(Collectors.toList());

        List<CloudRosterEnrollment> rosterEnrollments = enrollments.stream()
                .map(e -> new CloudRosterEnrollment(
                        e.courseId(),
                        e.traineeId(),
                        e.active(),
                        e.enrolledAt()
                ))
                .collect(Collectors.toList());

        return new CloudRosterResponse(
                hubId,
                generatedAt,
                rosterUsers,
                rosterCourses,
                instructorAssignments,
                rosterEnrollments
        );
    }

}
