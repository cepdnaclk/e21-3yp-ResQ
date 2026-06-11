package lk.resq.cloudapi.service;

import lk.resq.cloudapi.model.*;
import lk.resq.cloudapi.repository.CloudManagementRepository;
import lk.resq.cloudapi.repository.CloudSessionRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class CloudSessionSyncService {

    public static final String UNASSIGNED_LOCAL_HUB = "UNASSIGNED_LOCAL_HUB";

    private final CloudSessionRepository repository;
    private final CloudManagementRepository managementRepository;

    public CloudSessionSyncService(CloudSessionRepository repository, CloudManagementRepository managementRepository) {
        this.repository = repository;
        this.managementRepository = managementRepository;
    }

    public CloudSessionSyncResponse accept(CloudSessionSummarySyncPayload payload) {
        validate(payload);
        validateCourseAndUsers(payload);
        String idempotencyKey = idempotencyKey(payload.localHubId(), payload.localSessionId());
        Instant now = Instant.now();
        CloudSessionRecord candidate = new CloudSessionRecord(
                UUID.randomUUID().toString(),
                idempotencyKey,
                payload,
                now,
                now
        );
        CloudSessionRepository.SaveResult saved = repository.save(candidate);
        String result = saved.created() ? "CREATED" : "UPDATED";

        return new CloudSessionSyncResponse(
                true,
                result,
                saved.record().cloudSessionId(),
                idempotencyKey,
                CloudSyncContractVersion.CURRENT,
                saved.created() ? "Session summary accepted" : "Session summary updated"
        );
    }

    public CloudSessionRecord findByLocalIdentity(String localHubId, String localSessionId) {
        return repository.findByIdempotencyKey(idempotencyKey(localHubId, localSessionId))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Session summary not found"));
    }

    public List<CloudSessionRecord> findAll() {
        return repository.findAll();
    }

    public CloudSessionRecord findByCloudSessionId(String cloudSessionId) {
        return repository.findByCloudSessionId(cloudSessionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Cloud session not found"));
    }

    private static void validate(CloudSessionSummarySyncPayload payload) {
        if (payload == null) {
            throw badRequest("Request body is required");
        }
        if (!CloudSyncContractVersion.CURRENT.equals(payload.contractVersion())) {
            throw badRequest("contractVersion must be " + CloudSyncContractVersion.CURRENT);
        }
        if (payload.entityType() != CloudSyncEntityType.SESSION_SUMMARY) {
            throw badRequest("entityType must be SESSION_SUMMARY");
        }
        if (isBlank(payload.localSessionId())) {
            throw badRequest("localSessionId is required");
        }
    }

    private static String idempotencyKey(String localHubId, String localSessionId) {
        if (isBlank(localSessionId)) {
            throw badRequest("localSessionId is required");
        }
        String hubIdentity = isBlank(localHubId) ? UNASSIGNED_LOCAL_HUB : localHubId.trim();
        return hubIdentity + ":" + localSessionId.trim();
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private static ResponseStatusException badRequest(String reason) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, reason);
    }

    private void validateCourseAndUsers(CloudSessionSummarySyncPayload payload) {
        String courseId = payload.courseId();
        if (isBlank(courseId)) {
            return;
        }

        // 1. courseId must exist and be active when provided.
        CloudCourse course = managementRepository.findCourseById(courseId)
                .orElseThrow(() -> badRequest("Course not found: " + courseId));
        if (!course.active()) {
            throw badRequest("Course is inactive: " + courseId);
        }

        // 2. traineeId, if provided with courseId, must exist, be active, have role TRAINEE, and be enrolled in courseId.
        String traineeId = payload.traineeId();
        if (!isBlank(traineeId)) {
            CloudUser trainee = managementRepository.findUserById(traineeId)
                    .orElseThrow(() -> badRequest("Trainee not found: " + traineeId));
            if (!trainee.active()) {
                throw badRequest("Trainee is inactive: " + traineeId);
            }
            if (trainee.role() != CloudUserRole.TRAINEE) {
                throw badRequest("User " + traineeId + " does not have TRAINEE role");
            }
            // Check enrollment
            CloudEnrollment enrollment = managementRepository.findEnrollment(courseId, traineeId)
                    .orElseThrow(() -> badRequest("Trainee " + traineeId + " is not enrolled in course " + courseId));
            if (!enrollment.active()) {
                throw badRequest("Enrollment is inactive for trainee " + traineeId + " in course " + courseId);
            }
        }

        // 3. instructorId, if provided with courseId, must exist and be active.
        //    instructorId role may be INSTRUCTOR or ADMIN.
        //    If instructorId role is INSTRUCTOR, they must be assigned to courseId.
        //    If instructorId role is ADMIN, no course instructor assignment is required.
        String instructorId = payload.instructorId();
        if (!isBlank(instructorId)) {
            CloudUser instructor = managementRepository.findUserById(instructorId)
                    .orElseThrow(() -> badRequest("Instructor not found: " + instructorId));
            if (!instructor.active()) {
                throw badRequest("Instructor is inactive: " + instructorId);
            }
            if (instructor.role() != CloudUserRole.INSTRUCTOR && instructor.role() != CloudUserRole.ADMIN) {
                throw badRequest("User " + instructorId + " is neither an INSTRUCTOR nor an ADMIN");
            }
            if (instructor.role() == CloudUserRole.INSTRUCTOR) {
                if (course.instructorId() == null || !course.instructorId().equals(instructorId)) {
                    throw badRequest("Instructor " + instructorId + " is not assigned to course " + courseId);
                }
            }
        }
    }
}
