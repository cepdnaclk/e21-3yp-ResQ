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
            throw badRequest("invalid_payload", "Request body is required");
        }
        if (!CloudSyncContractVersion.CURRENT.equals(payload.contractVersion())) {
            throw badRequest("invalid_contract_version", "contractVersion must be " + CloudSyncContractVersion.CURRENT);
        }
        if (payload.entityType() != CloudSyncEntityType.SESSION_SUMMARY) {
            throw badRequest("invalid_entity_type", "entityType must be SESSION_SUMMARY");
        }
        if (isBlank(payload.localSessionId())) {
            throw badRequest("invalid_session_id", "localSessionId is required");
        }
    }

    private static String idempotencyKey(String localHubId, String localSessionId) {
        if (isBlank(localSessionId)) {
            throw badRequest("invalid_session_id", "localSessionId is required");
        }
        String hubIdentity = isBlank(localHubId) ? UNASSIGNED_LOCAL_HUB : localHubId.trim();
        return hubIdentity + ":" + localSessionId.trim();
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private static lk.resq.cloudapi.exception.BadRequestException badRequest(String error, String reason) {
        return new lk.resq.cloudapi.exception.BadRequestException(error, reason);
    }

    private static boolean isValidUuid(String value) {
        if (value == null) {
            return false;
        }
        try {
            UUID.fromString(value);
            return true;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    private void validateCourseAndUsers(CloudSessionSummarySyncPayload payload) {
        String courseId = payload.courseId();
        if (isBlank(courseId)) {
            return;
        }

        if (!isValidUuid(courseId)) {
            throw badRequest("invalid_course_id", "courseId must be a valid cloud UUID");
        }

        // 1. courseId must exist and be active when provided.
        CloudCourse course = managementRepository.findCourseById(courseId)
                .orElseThrow(() -> badRequest("invalid_course", "Course not found: " + courseId));
        if (!course.active()) {
            throw badRequest("invalid_course", "Course is inactive: " + courseId);
        }

        // 2. traineeId, if provided with courseId, must exist, be active, have role TRAINEE, and be enrolled in courseId.
        String traineeId = payload.traineeId();
        if (!isBlank(traineeId)) {
            if (!isValidUuid(traineeId)) {
                throw badRequest("invalid_user_id", "traineeId must be a valid cloud UUID");
            }
            CloudUser trainee = managementRepository.findUserById(traineeId)
                    .orElseThrow(() -> badRequest("invalid_user_id", "Trainee not found: " + traineeId));
            if (!trainee.active()) {
                throw badRequest("invalid_user_id", "Trainee is inactive: " + traineeId);
            }
            if (trainee.role() != CloudUserRole.TRAINEE) {
                throw badRequest("invalid_user_role", "User " + traineeId + " does not have TRAINEE role");
            }
            // Check enrollment
            CloudEnrollment enrollment = managementRepository.findEnrollment(courseId, traineeId)
                    .orElseThrow(() -> badRequest("invalid_course_relationship", "Trainee " + traineeId + " is not enrolled in course " + courseId));
            if (!enrollment.active()) {
                throw badRequest("invalid_course_relationship", "Enrollment is inactive for trainee " + traineeId + " in course " + courseId);
            }
        }

        // 3. instructorId, if provided with courseId, must exist and be active.
        //    instructorId role may be INSTRUCTOR or ADMIN.
        //    If instructorId role is INSTRUCTOR, they must be assigned to courseId.
        //    If instructorId role is ADMIN, no course instructor assignment is required.
        String instructorId = payload.instructorId();
        if (!isBlank(instructorId)) {
            if (!isValidUuid(instructorId)) {
                throw badRequest("invalid_user_id", "instructorId must be a valid cloud UUID");
            }
            CloudUser instructor = managementRepository.findUserById(instructorId)
                    .orElseThrow(() -> badRequest("invalid_user_id", "Instructor not found: " + instructorId));
            if (!instructor.active()) {
                throw badRequest("invalid_user_id", "Instructor is inactive: " + instructorId);
            }
            if (instructor.role() != CloudUserRole.INSTRUCTOR && instructor.role() != CloudUserRole.ADMIN) {
                throw badRequest("invalid_user_role", "User " + instructorId + " is neither an INSTRUCTOR nor an ADMIN");
            }
            if (instructor.role() == CloudUserRole.INSTRUCTOR) {
                if (course.instructorId() == null || !course.instructorId().equals(instructorId)) {
                    throw badRequest("invalid_course_relationship", "Instructor " + instructorId + " is not assigned to course " + courseId);
                }
            }
        }
    }
}
