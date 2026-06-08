package lk.resq.cloudapi.service;

import lk.resq.cloudapi.model.CloudCourse;
import lk.resq.cloudapi.model.CloudEnrollment;
import lk.resq.cloudapi.model.CloudUser;
import lk.resq.cloudapi.model.CloudUserRole;
import lk.resq.cloudapi.model.CreateCloudCourseRequest;
import lk.resq.cloudapi.model.CreateCloudEnrollmentRequest;
import lk.resq.cloudapi.model.CreateCloudUserRequest;
import lk.resq.cloudapi.repository.CloudManagementRepository;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class CloudManagementService {

    private static final Set<String> USER_PATCH_FIELDS =
            Set.of("displayName", "email", "role", "active");
    private static final Set<String> COURSE_PATCH_FIELDS =
            Set.of("courseCode", "title", "description", "instructorId", "active");

    private final CloudManagementRepository repository;

    public CloudManagementService(CloudManagementRepository repository) {
        this.repository = repository;
    }

    @Transactional
    public CloudUser createUser(CreateCloudUserRequest request) {
        if (request == null) {
            throw badRequest("Request body is required");
        }
        String displayName = requiredText(request.displayName(), "displayName");
        String email = optionalText(request.email());
        CloudUserRole role = parseRole(request.role());
        ensureEmailAvailable(email, null);
        Instant now = Instant.now();

        try {
            return repository.insertUser(new CloudUser(
                    UUID.randomUUID().toString(),
                    displayName,
                    email,
                    role,
                    true,
                    now,
                    now
            ));
        } catch (DataIntegrityViolationException error) {
            throw conflict("A user with that email already exists");
        }
    }

    public List<CloudUser> listUsers() {
        return repository.findAllUsers();
    }

    public CloudUser getUser(String userId) {
        validateUuid(userId, "userId");
        return repository.findUserById(userId)
                .orElseThrow(() -> notFound("Cloud user not found"));
    }

    @Transactional
    public CloudUser updateUser(String userId, Map<String, Object> patch) {
        validatePatch(patch, USER_PATCH_FIELDS);
        CloudUser existing = getUser(userId);

        String displayName = patch.containsKey("displayName")
                ? requiredText(asString(patch.get("displayName"), "displayName"), "displayName")
                : existing.displayName();
        String email = patch.containsKey("email")
                ? optionalText(asNullableString(patch.get("email"), "email"))
                : existing.email();
        CloudUserRole role = patch.containsKey("role")
                ? parseRole(asString(patch.get("role"), "role"))
                : existing.role();
        boolean active = patch.containsKey("active")
                ? asBoolean(patch.get("active"), "active")
                : existing.active();

        ensureEmailAvailable(email, userId);
        try {
            return repository.updateUser(new CloudUser(
                    existing.userId(),
                    displayName,
                    email,
                    role,
                    active,
                    existing.createdAt(),
                    Instant.now()
            ));
        } catch (DataIntegrityViolationException error) {
            throw conflict("A user with that email already exists");
        }
    }

    @Transactional
    public CloudCourse createCourse(CreateCloudCourseRequest request) {
        if (request == null) {
            throw badRequest("Request body is required");
        }
        String title = requiredText(request.title(), "title");
        String courseCode = optionalText(request.courseCode());
        String description = optionalText(request.description());
        String instructorId = optionalText(request.instructorId());
        validateInstructor(instructorId);
        ensureCourseCodeAvailable(courseCode, null);
        Instant now = Instant.now();

        try {
            return repository.insertCourse(new CloudCourse(
                    UUID.randomUUID().toString(),
                    courseCode,
                    title,
                    description,
                    instructorId,
                    null,
                    true,
                    now,
                    now
            ));
        } catch (DataIntegrityViolationException error) {
            throw conflict("A course with that courseCode already exists");
        }
    }

    public List<CloudCourse> listCourses() {
        return repository.findAllCourses();
    }

    public CloudCourse getCourse(String courseId) {
        validateUuid(courseId, "courseId");
        return repository.findCourseById(courseId)
                .orElseThrow(() -> notFound("Cloud course not found"));
    }

    @Transactional
    public CloudCourse updateCourse(String courseId, Map<String, Object> patch) {
        validatePatch(patch, COURSE_PATCH_FIELDS);
        CloudCourse existing = getCourse(courseId);

        String courseCode = patch.containsKey("courseCode")
                ? optionalText(asNullableString(patch.get("courseCode"), "courseCode"))
                : existing.courseCode();
        String title = patch.containsKey("title")
                ? requiredText(asString(patch.get("title"), "title"), "title")
                : existing.title();
        String description = patch.containsKey("description")
                ? optionalText(asNullableString(patch.get("description"), "description"))
                : existing.description();
        String instructorId = patch.containsKey("instructorId")
                ? optionalText(asNullableString(patch.get("instructorId"), "instructorId"))
                : existing.instructorId();
        boolean active = patch.containsKey("active")
                ? asBoolean(patch.get("active"), "active")
                : existing.active();

        validateInstructor(instructorId);
        ensureCourseCodeAvailable(courseCode, courseId);
        try {
            return repository.updateCourse(new CloudCourse(
                    existing.courseId(),
                    courseCode,
                    title,
                    description,
                    instructorId,
                    existing.instructorDisplayName(),
                    active,
                    existing.createdAt(),
                    Instant.now()
            ));
        } catch (DataIntegrityViolationException error) {
            throw conflict("A course with that courseCode already exists");
        }
    }

    @Transactional
    public CloudEnrollment enrollTrainee(String courseId, CreateCloudEnrollmentRequest request) {
        CloudCourse course = getCourse(courseId);
        if (request == null) {
            throw badRequest("Request body is required");
        }
        String traineeId = requiredText(request.traineeId(), "traineeId");
        validateUuid(traineeId, "traineeId");
        CloudUser trainee = getUser(traineeId);
        if (trainee.role() != CloudUserRole.TRAINEE) {
            throw badRequest("Only users with role TRAINEE can be enrolled");
        }

        CloudEnrollment existing = repository.findEnrollment(course.courseId(), traineeId).orElse(null);
        Instant enrolledAt = existing == null ? Instant.now() : existing.enrolledAt();
        return repository.saveEnrollment(new CloudEnrollment(
                existing == null ? UUID.randomUUID().toString() : existing.enrollmentId(),
                course.courseId(),
                traineeId,
                trainee.displayName(),
                trainee.email(),
                true,
                enrolledAt
        ));
    }

    public List<CloudEnrollment> listCourseEnrollments(String courseId) {
        getCourse(courseId);
        return repository.findCourseEnrollments(courseId);
    }

    @Transactional
    public void removeEnrollment(String courseId, String traineeId) {
        getCourse(courseId);
        validateUuid(traineeId, "traineeId");
        repository.findEnrollment(courseId, traineeId)
                .orElseThrow(() -> notFound("Course enrollment not found"));
        repository.deactivateEnrollment(courseId, traineeId);
    }

    private void validateInstructor(String instructorId) {
        if (instructorId == null) {
            return;
        }
        validateUuid(instructorId, "instructorId");
        CloudUser instructor = getUser(instructorId);
        if (instructor.role() != CloudUserRole.INSTRUCTOR && instructor.role() != CloudUserRole.ADMIN) {
            throw badRequest("instructorId must reference an INSTRUCTOR or ADMIN user");
        }
    }

    private void ensureEmailAvailable(String email, String currentUserId) {
        if (email == null) {
            return;
        }
        repository.findUserByEmail(email)
                .filter(user -> !user.userId().equals(currentUserId))
                .ifPresent(user -> {
                    throw conflict("A user with that email already exists");
                });
    }

    private void ensureCourseCodeAvailable(String courseCode, String currentCourseId) {
        if (courseCode == null) {
            return;
        }
        repository.findCourseByCode(courseCode)
                .filter(course -> !course.courseId().equals(currentCourseId))
                .ifPresent(course -> {
                    throw conflict("A course with that courseCode already exists");
                });
    }

    private static CloudUserRole parseRole(String value) {
        String role = requiredText(value, "role");
        try {
            return CloudUserRole.valueOf(role.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException error) {
            throw badRequest("role must be ADMIN, INSTRUCTOR, or TRAINEE");
        }
    }

    private static void validatePatch(Map<String, Object> patch, Set<String> allowedFields) {
        if (patch == null || patch.isEmpty()) {
            throw badRequest("At least one field is required");
        }
        patch.keySet().stream()
                .filter(field -> !allowedFields.contains(field))
                .findFirst()
                .ifPresent(field -> {
                    throw badRequest("Unsupported field: " + field);
                });
    }

    private static String requiredText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw badRequest(field + " is required");
        }
        return value.trim();
    }

    private static String optionalText(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static String asString(Object value, String field) {
        if (!(value instanceof String text)) {
            throw badRequest(field + " must be a string");
        }
        return text;
    }

    private static String asNullableString(Object value, String field) {
        if (value == null) {
            return null;
        }
        return asString(value, field);
    }

    private static boolean asBoolean(Object value, String field) {
        if (!(value instanceof Boolean bool)) {
            throw badRequest(field + " must be true or false");
        }
        return bool;
    }

    private static void validateUuid(String value, String field) {
        try {
            UUID.fromString(value);
        } catch (IllegalArgumentException | NullPointerException error) {
            throw badRequest(field + " must be a valid UUID");
        }
    }

    private static ResponseStatusException badRequest(String reason) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, reason);
    }

    private static ResponseStatusException notFound(String reason) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, reason);
    }

    private static ResponseStatusException conflict(String reason) {
        return new ResponseStatusException(HttpStatus.CONFLICT, reason);
    }
}
