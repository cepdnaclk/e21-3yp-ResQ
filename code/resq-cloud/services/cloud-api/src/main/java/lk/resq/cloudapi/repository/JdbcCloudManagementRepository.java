package lk.resq.cloudapi.repository;

import lk.resq.cloudapi.model.CloudCourse;
import lk.resq.cloudapi.model.CloudEnrollment;
import lk.resq.cloudapi.model.CloudUser;
import lk.resq.cloudapi.model.CloudUserCredentials;
import lk.resq.cloudapi.model.CloudUserRole;
import lk.resq.cloudapi.model.CloudRosterUser;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public class JdbcCloudManagementRepository implements CloudManagementRepository {

    private static final String USER_SELECT = """
            SELECT user_id, display_name, email, role, active, created_at, updated_at
            FROM cloud_users
            """;
    private static final String USER_CREDENTIALS_SELECT = """
            SELECT user_id, display_name, email, role, active, created_at, updated_at,
                   password_hash, last_login_at, password_updated_at
            FROM cloud_users
            """;
    private static final String COURSE_SELECT = """
            SELECT c.course_id, c.course_code, c.title, c.description, c.instructor_id,
                   u.display_name AS instructor_display_name, c.active, c.created_at, c.updated_at
            FROM cloud_courses c
            LEFT JOIN cloud_users u ON u.user_id = c.instructor_id
            """;
    private static final String ENROLLMENT_SELECT = """
            SELECT e.enrollment_id, e.course_id, e.trainee_id,
                   u.display_name AS trainee_display_name, u.email AS trainee_email,
                   e.active, e.enrolled_at
            FROM cloud_enrollments e
            JOIN cloud_users u ON u.user_id = e.trainee_id
            """;

    private final JdbcTemplate jdbcTemplate;
    private final RowMapper<CloudUser> userMapper = this::mapUser;
    private final RowMapper<CloudCourse> courseMapper = this::mapCourse;
    private final RowMapper<CloudEnrollment> enrollmentMapper = this::mapEnrollment;

    public JdbcCloudManagementRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public CloudUser insertUser(CloudUser user, String passwordHash, Instant passwordUpdatedAt) {
        jdbcTemplate.update("""
                        INSERT INTO cloud_users (
                            user_id, display_name, email, role, active, created_at, updated_at,
                            password_hash, password_updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                uuid(user.userId()), user.displayName(), user.email(), user.role().name(),
                user.active(), timestamp(user.createdAt()), timestamp(user.updatedAt()),
                passwordHash, nullableTimestamp(passwordUpdatedAt));
        return user;
    }

    @Override
    public CloudUser updateUser(CloudUser user) {
        jdbcTemplate.update("""
                        UPDATE cloud_users
                        SET display_name = ?, email = ?, role = ?, active = ?, updated_at = ?
                        WHERE user_id = ?
                        """,
                user.displayName(), user.email(), user.role().name(), user.active(),
                timestamp(user.updatedAt()), uuid(user.userId()));
        return user;
    }

    @Override
    public Optional<CloudUser> findUserById(String userId) {
        return first(jdbcTemplate.query(USER_SELECT + " WHERE user_id = ?", userMapper, uuid(userId)));
    }

    @Override
    public Optional<CloudUser> findUserByEmail(String email) {
        return first(jdbcTemplate.query(USER_SELECT + " WHERE LOWER(email) = LOWER(?)", userMapper, email));
    }

    @Override
    public Optional<CloudUserCredentials> findUserCredentialsById(String userId) {
        return first(jdbcTemplate.query(
                USER_CREDENTIALS_SELECT + " WHERE user_id = ?",
                this::mapUserCredentials,
                uuid(userId)
        ));
    }

    @Override
    public Optional<CloudUserCredentials> findUserCredentialsByEmail(String email) {
        return first(jdbcTemplate.query(
                USER_CREDENTIALS_SELECT + " WHERE LOWER(email) = LOWER(?)",
                this::mapUserCredentials,
                email
        ));
    }

    @Override
    public boolean existsAdminUser() {
        Integer count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM cloud_users WHERE role = 'ADMIN'",
                Integer.class
        );
        return count != null && count > 0;
    }

    @Override
    public void updatePassword(String userId, String passwordHash, Instant passwordUpdatedAt) {
        jdbcTemplate.update("""
                        UPDATE cloud_users
                        SET password_hash = ?, password_updated_at = ?, updated_at = ?
                        WHERE user_id = ?
                        """,
                passwordHash, timestamp(passwordUpdatedAt), timestamp(passwordUpdatedAt), uuid(userId));
    }

    @Override
    public void updateLocalLoginHash(String userId, String localLoginHash) {
        jdbcTemplate.update(
                "UPDATE cloud_users SET local_login_hash = ?, updated_at = ? WHERE user_id = ?",
                localLoginHash,
                timestamp(Instant.now()),
                uuid(userId)
        );
    }

    @Override
    public void updateLastLogin(String userId, Instant lastLoginAt) {
        jdbcTemplate.update(
                "UPDATE cloud_users SET last_login_at = ? WHERE user_id = ?",
                timestamp(lastLoginAt),
                uuid(userId)
        );
    }

    @Override
    public List<CloudUser> findAllUsers() {
        return jdbcTemplate.query(USER_SELECT + " ORDER BY display_name, user_id", userMapper);
    }

    @Override
    public List<CloudRosterUser> findAllRosterUsers() {
        return jdbcTemplate.query("""
                SELECT user_id, display_name, email, role, active, updated_at, local_login_hash
                FROM cloud_users
                ORDER BY display_name, user_id
                """, (rs, rowNum) -> new CloudRosterUser(
                    rs.getObject("user_id", java.util.UUID.class).toString(),
                    rs.getString("display_name"),
                    rs.getString("email"),
                    rs.getString("role"),
                    rs.getBoolean("active"),
                    rs.getObject("updated_at", java.time.OffsetDateTime.class).toInstant(),
                    rs.getString("local_login_hash")
                ));
    }

    @Override
    public CloudCourse insertCourse(CloudCourse course) {
        jdbcTemplate.update("""
                        INSERT INTO cloud_courses (
                            course_id, course_code, title, description, instructor_id,
                            active, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                uuid(course.courseId()), course.courseCode(), course.title(), course.description(),
                nullableUuid(course.instructorId()), course.active(),
                timestamp(course.createdAt()), timestamp(course.updatedAt()));
        return findCourseById(course.courseId()).orElseThrow();
    }

    @Override
    public CloudCourse updateCourse(CloudCourse course) {
        jdbcTemplate.update("""
                        UPDATE cloud_courses
                        SET course_code = ?, title = ?, description = ?, instructor_id = ?,
                            active = ?, updated_at = ?
                        WHERE course_id = ?
                        """,
                course.courseCode(), course.title(), course.description(),
                nullableUuid(course.instructorId()), course.active(),
                timestamp(course.updatedAt()), uuid(course.courseId()));
        return findCourseById(course.courseId()).orElseThrow();
    }

    @Override
    public Optional<CloudCourse> findCourseById(String courseId) {
        return first(jdbcTemplate.query(COURSE_SELECT + " WHERE c.course_id = ?", courseMapper, uuid(courseId)));
    }

    @Override
    public Optional<CloudCourse> findCourseByCode(String courseCode) {
        return first(jdbcTemplate.query(COURSE_SELECT + " WHERE LOWER(c.course_code) = LOWER(?)", courseMapper, courseCode));
    }

    @Override
    public List<CloudCourse> findAllCourses() {
        return jdbcTemplate.query(COURSE_SELECT + " ORDER BY c.title, c.course_id", courseMapper);
    }

    @Override
    public CloudEnrollment saveEnrollment(CloudEnrollment enrollment) {
        Optional<CloudEnrollment> existing = findEnrollment(enrollment.courseId(), enrollment.traineeId());
        if (existing.isPresent()) {
            jdbcTemplate.update("""
                            UPDATE cloud_enrollments SET active = TRUE
                            WHERE course_id = ? AND trainee_id = ?
                            """,
                    uuid(enrollment.courseId()), uuid(enrollment.traineeId()));
        } else {
            jdbcTemplate.update("""
                            INSERT INTO cloud_enrollments (
                                enrollment_id, course_id, trainee_id, active, enrolled_at
                            ) VALUES (?, ?, ?, TRUE, ?)
                            """,
                    uuid(enrollment.enrollmentId()), uuid(enrollment.courseId()),
                    uuid(enrollment.traineeId()), timestamp(enrollment.enrolledAt()));
        }
        return findEnrollment(enrollment.courseId(), enrollment.traineeId()).orElseThrow();
    }

    @Override
    public Optional<CloudEnrollment> findEnrollment(String courseId, String traineeId) {
        return first(jdbcTemplate.query(
                ENROLLMENT_SELECT + " WHERE e.course_id = ? AND e.trainee_id = ?",
                enrollmentMapper,
                uuid(courseId),
                uuid(traineeId)
        ));
    }

    @Override
    public List<CloudEnrollment> findCourseEnrollments(String courseId) {
        return jdbcTemplate.query(
                ENROLLMENT_SELECT + " WHERE e.course_id = ? ORDER BY e.active DESC, u.display_name",
                enrollmentMapper,
                uuid(courseId)
        );
    }

    @Override
    public void deactivateEnrollment(String courseId, String traineeId) {
        jdbcTemplate.update("""
                        UPDATE cloud_enrollments SET active = FALSE
                        WHERE course_id = ? AND trainee_id = ?
                        """,
                uuid(courseId), uuid(traineeId));
    }

    private CloudUser mapUser(ResultSet rs, int rowNumber) throws SQLException {
        return new CloudUser(
                rs.getObject("user_id", UUID.class).toString(),
                rs.getString("display_name"),
                rs.getString("email"),
                CloudUserRole.valueOf(rs.getString("role")),
                rs.getBoolean("active"),
                instant(rs, "created_at"),
                instant(rs, "updated_at")
        );
    }

    private CloudUserCredentials mapUserCredentials(ResultSet rs, int rowNumber) throws SQLException {
        return new CloudUserCredentials(
                mapUser(rs, rowNumber),
                rs.getString("password_hash"),
                nullableInstant(rs, "last_login_at"),
                nullableInstant(rs, "password_updated_at")
        );
    }

    private CloudCourse mapCourse(ResultSet rs, int rowNumber) throws SQLException {
        Object instructorId = rs.getObject("instructor_id");
        return new CloudCourse(
                rs.getObject("course_id", UUID.class).toString(),
                rs.getString("course_code"),
                rs.getString("title"),
                rs.getString("description"),
                instructorId == null ? null : instructorId.toString(),
                rs.getString("instructor_display_name"),
                rs.getBoolean("active"),
                instant(rs, "created_at"),
                instant(rs, "updated_at")
        );
    }

    private CloudEnrollment mapEnrollment(ResultSet rs, int rowNumber) throws SQLException {
        return new CloudEnrollment(
                rs.getObject("enrollment_id", UUID.class).toString(),
                rs.getObject("course_id", UUID.class).toString(),
                rs.getObject("trainee_id", UUID.class).toString(),
                rs.getString("trainee_display_name"),
                rs.getString("trainee_email"),
                rs.getBoolean("active"),
                instant(rs, "enrolled_at")
        );
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        return rs.getObject(column, java.time.OffsetDateTime.class).toInstant();
    }

    private static Instant nullableInstant(ResultSet rs, String column) throws SQLException {
        java.time.OffsetDateTime value = rs.getObject(column, java.time.OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }

    private static Timestamp timestamp(Instant value) {
        return Timestamp.from(value);
    }

    private static Timestamp nullableTimestamp(Instant value) {
        return value == null ? null : timestamp(value);
    }

    private static UUID uuid(String value) {
        return UUID.fromString(value);
    }

    private static UUID nullableUuid(String value) {
        return value == null ? null : uuid(value);
    }

    private static <T> Optional<T> first(List<T> values) {
        return values.stream().findFirst();
    }
}
