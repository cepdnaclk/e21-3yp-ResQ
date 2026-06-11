package lk.resq.cloudapi.service;

import lk.resq.cloudapi.model.*;
import lk.resq.cloudapi.repository.CloudManagementRepository;
import lk.resq.cloudapi.repository.CloudSessionRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;
import java.util.stream.Collectors;

@Service
public class CloudSessionReportService {

    private final CloudSessionRepository sessionRepository;
    private final CloudManagementRepository managementRepository;

    public CloudSessionReportService(
            CloudSessionRepository sessionRepository,
            CloudManagementRepository managementRepository
    ) {
        this.sessionRepository = sessionRepository;
        this.managementRepository = managementRepository;
    }

    public List<CloudSessionRecord> searchSessionSummaries(
            CloudUser actor,
            String courseId,
            String traineeId,
            String instructorId,
            Instant dateFrom,
            Instant dateTo,
            Integer limit,
            Integer offset
    ) {
        // Enforce safe pagination
        int finalLimit = (limit == null) ? 50 : limit;
        if (finalLimit < 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Limit cannot be negative");
        }
        if (finalLimit > 200) {
            finalLimit = 200;
        }

        int finalOffset = (offset == null) ? 0 : offset;
        if (finalOffset < 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Offset cannot be negative");
        }

        if (actor.role() == CloudUserRole.ADMIN) {
            // ADMIN can view all summaries and filter by any course, trainee, instructor.
            return sessionRepository.findWithFilters(
                    courseId, traineeId, instructorId, dateFrom, dateTo,
                    null, null, null, finalLimit, finalOffset
            );
        } else if (actor.role() == CloudUserRole.INSTRUCTOR) {
            // Get instructor's assigned active course IDs
            List<String> assignedCourseIds = managementRepository.findAssignedCourseIds(actor.userId());

            // If a specific courseId is requested, verify the instructor is assigned to it.
            // Prefer 404 for hidden course resources to avoid leaking existence.
            if (courseId != null) {
                if (!assignedCourseIds.contains(courseId)) {
                    throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Course not found");
                }
            }

            // If a specific traineeId is requested, trainee must belong to an assigned course summary scope.
            if (traineeId != null) {
                boolean traineeInScope = false;
                for (String cId : assignedCourseIds) {
                    if (managementRepository.findEnrollment(cId, traineeId).map(CloudEnrollment::active).orElse(false)) {
                        traineeInScope = true;
                        break;
                    }
                }
                if (!traineeInScope) {
                    throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Trainee not found");
                }
            }

            // Instructors can see summaries for courses they are assigned to, and null-course summaries
            // only when instructor_id equals their user ID.
            return sessionRepository.findWithFilters(
                    courseId, traineeId, instructorId, dateFrom, dateTo,
                    assignedCourseIds, actor.userId(), null, finalLimit, finalOffset
            );
        } else if (actor.role() == CloudUserRole.TRAINEE) {
            // Trainee can only view their own summaries.
            // If they query a traineeId different than their own, reject with 403 Forbidden.
            if (traineeId != null && !traineeId.equals(actor.userId())) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Access denied");
            }
            String restrictedTraineeId = actor.userId();

            // Resolve trainee's enrolled active course IDs
            List<String> enrolledCourseIds = managementRepository.findAllCourses().stream()
                    .filter(CloudCourse::active)
                    .map(CloudCourse::courseId)
                    .filter(cId -> managementRepository.findEnrollment(cId, actor.userId()).map(CloudEnrollment::active).orElse(false))
                    .collect(Collectors.toList());

            // If a specific courseId is requested, verify the trainee is enrolled in it.
            if (courseId != null) {
                if (!enrolledCourseIds.contains(courseId)) {
                    throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Course not found");
                }
            }

            // Trainees can see summaries in enrolled courses, and null-course summaries
            // only when trainee_id equals their user ID.
            return sessionRepository.findWithFilters(
                    courseId, restrictedTraineeId, instructorId, dateFrom, dateTo,
                    enrolledCourseIds, null, actor.userId(), finalLimit, finalOffset
            );
        } else {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Access denied");
        }
    }

    public CloudSessionRecord findByCloudSessionId(CloudUser actor, String cloudSessionId) {
        CloudSessionRecord record = sessionRepository.findByCloudSessionId(cloudSessionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Session not found"));

        // Enforce the same security rules for single record access
        if (actor.role() == CloudUserRole.ADMIN) {
            return record;
        }

        String sessionCourseId = record.payload().courseId();
        if (actor.role() == CloudUserRole.INSTRUCTOR) {
            if (sessionCourseId != null) {
                List<String> assignedCourseIds = managementRepository.findAssignedCourseIds(actor.userId());
                if (!assignedCourseIds.contains(sessionCourseId)) {
                    throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Session not found");
                }
            } else {
                // Null-course summary: allowed only if instructor matches actor
                if (!actor.userId().equals(record.payload().instructorId())) {
                    throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Session not found");
                }
            }
            return record;
        } else if (actor.role() == CloudUserRole.TRAINEE) {
            // Trainee can only see their own sessions
            if (!actor.userId().equals(record.payload().traineeId())) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Access denied");
            }
            if (sessionCourseId != null) {
                boolean enrolled = managementRepository.findEnrollment(sessionCourseId, actor.userId())
                        .map(CloudEnrollment::active)
                        .orElse(false);
                if (!enrolled) {
                    throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Session not found");
                }
            }
            return record;
        }

        throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Access denied");
    }
}
