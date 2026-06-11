package lk.resq.cloudapi.repository;

import lk.resq.cloudapi.model.CloudSessionRecord;

import java.util.List;
import java.util.Optional;

public interface CloudSessionRepository {

    SaveResult save(CloudSessionRecord record);

    Optional<CloudSessionRecord> findByIdempotencyKey(String idempotencyKey);

    Optional<CloudSessionRecord> findByCloudSessionId(String cloudSessionId);

    List<CloudSessionRecord> findAll();

    List<CloudSessionRecord> findWithFilters(
            String courseId,
            String traineeId,
            String instructorId,
            java.time.Instant dateFrom,
            java.time.Instant dateTo,
            List<String> allowedCourseIds,
            String allowNullCourseIfInstructorMatches,
            String allowNullCourseIfTraineeMatches,
            Integer limit,
            Integer offset
    );

    record SaveResult(CloudSessionRecord record, boolean created) {
    }
}
