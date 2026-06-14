package lk.resq.localhub.service;

import jakarta.annotation.PostConstruct;
import lk.resq.localhub.model.cloudsync.CloudRosterCourse;
import lk.resq.localhub.model.cloudsync.CloudRosterEnrollment;
import lk.resq.localhub.model.cloudsync.CloudRosterInstructorAssignment;
import lk.resq.localhub.model.cloudsync.CloudRosterUser;
import lk.resq.localhub.model.roster.CourseInstructorView;
import lk.resq.localhub.model.roster.CourseStudentView;
import lk.resq.localhub.model.roster.CourseView;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Repository;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * SQLite-backed cache for the cloud-master roster pulled via
 * {@link RosterSyncClient} (GET /api/sync/roster).
 *
 * <p>Tables are created with {@code CREATE TABLE IF NOT EXISTS} in
 * {@link #initialize()} so no migration tool is needed. This follows
 * the same pattern used by {@link SyncQueueRepository}.</p>
 *
 * <h2>Tables</h2>
 * <ul>
 *   <li>{@code cloud_synced_users}         — cloud user records (no password hash)</li>
 *   <li>{@code local_courses}              — cloud course records</li>
 *   <li>{@code local_course_instructors}   — instructor-to-course assignments</li>
 *   <li>{@code local_course_enrollments}   — trainee enrollments</li>
 *   <li>{@code roster_sync_state}          — one-row audit of the last sync attempt</li>
 * </ul>
 */
@Repository
public class RosterCacheRepository {

    /** Key used for the single row in roster_sync_state. */
    public static final String SYNC_STATE_KEY = "default";

    private final Path databasePath;
    private final String jdbcUrl;

    public RosterCacheRepository(
            @Value("${resq.storage.sqlite-path:${user.home}/.resq-localhub/hub-api.sqlite}") String sqlitePath
    ) {
        this.databasePath = Path.of(sqlitePath).toAbsolutePath();
        this.jdbcUrl = "jdbc:sqlite:" + this.databasePath.toString().replace("\\", "/");
    }

    // -------------------------------------------------------------------------
    // Initialisation
    // -------------------------------------------------------------------------

    @PostConstruct
    public void initialize() {
        try {
            Path parent = databasePath.getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }
            try (Connection connection = openConnection();
                 Statement statement = connection.createStatement()) {

                statement.executeUpdate("PRAGMA journal_mode = WAL");
                statement.executeUpdate("PRAGMA foreign_keys = ON");

                statement.executeUpdate("""
                        CREATE TABLE IF NOT EXISTS cloud_synced_users (
                          cloud_user_id    TEXT PRIMARY KEY,
                          display_name     TEXT NOT NULL,
                          email            TEXT,
                          role             TEXT NOT NULL,
                          active           INTEGER NOT NULL,
                          updated_at       TEXT,
                          last_synced_at   TEXT NOT NULL
                        )
                        """);

                statement.executeUpdate("""
                        CREATE TABLE IF NOT EXISTS local_courses (
                          cloud_course_id           TEXT PRIMARY KEY,
                          course_code               TEXT,
                          title                     TEXT NOT NULL,
                          description               TEXT,
                          instructor_cloud_user_id  TEXT,
                          active                    INTEGER NOT NULL,
                          updated_at                TEXT,
                          last_synced_at            TEXT NOT NULL
                        )
                        """);

                statement.executeUpdate("""
                        CREATE TABLE IF NOT EXISTS local_course_instructors (
                          cloud_course_id            TEXT NOT NULL,
                          instructor_cloud_user_id   TEXT NOT NULL,
                          active                     INTEGER NOT NULL,
                          last_synced_at             TEXT NOT NULL,
                          PRIMARY KEY (cloud_course_id, instructor_cloud_user_id)
                        )
                        """);

                statement.executeUpdate("""
                        CREATE TABLE IF NOT EXISTS local_course_enrollments (
                          cloud_course_id        TEXT NOT NULL,
                          trainee_cloud_user_id  TEXT NOT NULL,
                          active                 INTEGER NOT NULL,
                          enrolled_at            TEXT,
                          last_synced_at         TEXT NOT NULL,
                          PRIMARY KEY (cloud_course_id, trainee_cloud_user_id)
                        )
                        """);

                statement.executeUpdate("""
                        CREATE TABLE IF NOT EXISTS roster_sync_state (
                          sync_key             TEXT PRIMARY KEY,
                          last_attempt_at      TEXT,
                          last_success_at      TEXT,
                          last_error           TEXT,
                          last_user_count      INTEGER,
                          last_course_count    INTEGER,
                          last_enrollment_count INTEGER
                        )
                        """);

                // Seed the single roster_sync_state row if absent.
                statement.executeUpdate("""
                        INSERT OR IGNORE INTO roster_sync_state (sync_key)
                        VALUES ('""" + SYNC_STATE_KEY + "')");

                ensureColumn(connection, "cloud_synced_users", "local_login_hash", "TEXT NULL");
            }
        } catch (IOException | SQLException error) {
            throw new IllegalStateException(
                    "Failed to initialize roster cache tables at " + databasePath, error);
        }
    }

    // -------------------------------------------------------------------------
    // Upsert helpers (called by RosterSyncService)
    // -------------------------------------------------------------------------

    /**
     * Upsert one cloud user into {@code cloud_synced_users}.
     * Idempotent — safe to call on every roster sync.
     */
    public synchronized void upsertUser(CloudRosterUser user, Instant syncedAt) {
        try (Connection connection = openConnection();
             PreparedStatement ps = connection.prepareStatement("""
                     INSERT INTO cloud_synced_users
                       (cloud_user_id, display_name, email, role, active, updated_at, last_synced_at, local_login_hash)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT(cloud_user_id) DO UPDATE SET
                       display_name     = excluded.display_name,
                       email            = excluded.email,
                       role             = excluded.role,
                       active           = excluded.active,
                       updated_at       = excluded.updated_at,
                       last_synced_at   = excluded.last_synced_at,
                       local_login_hash = excluded.local_login_hash
                     """)) {
            ps.setString(1, user.cloudUserId());
            ps.setString(2, user.displayName());
            ps.setString(3, user.email());
            ps.setString(4, user.role());
            ps.setInt(5, user.active() ? 1 : 0);
            ps.setString(6, nullableInstantStr(user.updatedAt()));
            ps.setString(7, syncedAt.toString());
            ps.setString(8, user.localLoginHash());
            ps.executeUpdate();
        } catch (SQLException error) {
            throw new IllegalStateException(
                    "Failed to upsert synced user " + user.cloudUserId(), error);
        }
    }

    /**
     * Upsert one course into {@code local_courses}.
     */
    public synchronized void upsertCourse(CloudRosterCourse course, Instant syncedAt) {
        try (Connection connection = openConnection();
             PreparedStatement ps = connection.prepareStatement("""
                     INSERT INTO local_courses
                       (cloud_course_id, course_code, title, description,
                        instructor_cloud_user_id, active, updated_at, last_synced_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT(cloud_course_id) DO UPDATE SET
                       course_code               = excluded.course_code,
                       title                     = excluded.title,
                       description               = excluded.description,
                       instructor_cloud_user_id  = excluded.instructor_cloud_user_id,
                       active                    = excluded.active,
                       updated_at                = excluded.updated_at,
                       last_synced_at            = excluded.last_synced_at
                     """)) {
            ps.setString(1, course.cloudCourseId());
            ps.setString(2, course.courseCode());
            ps.setString(3, course.title());
            ps.setString(4, course.description());
            ps.setString(5, course.instructorId());
            ps.setInt(6, course.active() ? 1 : 0);
            ps.setString(7, nullableInstantStr(course.updatedAt()));
            ps.setString(8, syncedAt.toString());
            ps.executeUpdate();
        } catch (SQLException error) {
            throw new IllegalStateException(
                    "Failed to upsert course " + course.cloudCourseId(), error);
        }
    }

    /**
     * Upsert one instructor assignment into {@code local_course_instructors}.
     */
    public synchronized void upsertInstructorAssignment(
            CloudRosterInstructorAssignment assignment, Instant syncedAt) {
        try (Connection connection = openConnection();
             PreparedStatement ps = connection.prepareStatement("""
                     INSERT INTO local_course_instructors
                       (cloud_course_id, instructor_cloud_user_id, active, last_synced_at)
                     VALUES (?, ?, ?, ?)
                     ON CONFLICT(cloud_course_id, instructor_cloud_user_id) DO UPDATE SET
                       active         = excluded.active,
                       last_synced_at = excluded.last_synced_at
                     """)) {
            ps.setString(1, assignment.courseId());
            ps.setString(2, assignment.instructorUserId());
            ps.setInt(3, assignment.active() ? 1 : 0);
            ps.setString(4, syncedAt.toString());
            ps.executeUpdate();
        } catch (SQLException error) {
            throw new IllegalStateException(
                    "Failed to upsert instructor assignment for course "
                            + assignment.courseId(), error);
        }
    }

    /**
     * Upsert one enrollment into {@code local_course_enrollments}.
     */
    public synchronized void upsertEnrollment(CloudRosterEnrollment enrollment, Instant syncedAt) {
        try (Connection connection = openConnection();
             PreparedStatement ps = connection.prepareStatement("""
                     INSERT INTO local_course_enrollments
                       (cloud_course_id, trainee_cloud_user_id, active, enrolled_at, last_synced_at)
                     VALUES (?, ?, ?, ?, ?)
                     ON CONFLICT(cloud_course_id, trainee_cloud_user_id) DO UPDATE SET
                       active         = excluded.active,
                       enrolled_at    = excluded.enrolled_at,
                       last_synced_at = excluded.last_synced_at
                     """)) {
            ps.setString(1, enrollment.courseId());
            ps.setString(2, enrollment.traineeUserId());
            ps.setInt(3, enrollment.active() ? 1 : 0);
            ps.setString(4, nullableInstantStr(enrollment.enrolledAt()));
            ps.setString(5, syncedAt.toString());
            ps.executeUpdate();
        } catch (SQLException error) {
            throw new IllegalStateException(
                    "Failed to upsert enrollment for course "
                            + enrollment.courseId(), error);
        }
    }

    // -------------------------------------------------------------------------
    // Sync state
    // -------------------------------------------------------------------------

    /** Record the start of a sync attempt (only last_attempt_at is written). */
    public synchronized void recordAttempt(Instant attemptAt) {
        try (Connection connection = openConnection();
             PreparedStatement ps = connection.prepareStatement("""
                     UPDATE roster_sync_state
                     SET last_attempt_at = ?
                     WHERE sync_key = ?
                     """)) {
            ps.setString(1, attemptAt.toString());
            ps.setString(2, SYNC_STATE_KEY);
            ps.executeUpdate();
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to record roster sync attempt", error);
        }
    }

    /** Record a successful sync with entity counts. */
    public synchronized void recordSuccess(
            Instant successAt, int userCount, int courseCount, int enrollmentCount) {
        try (Connection connection = openConnection();
             PreparedStatement ps = connection.prepareStatement("""
                     UPDATE roster_sync_state
                     SET last_success_at       = ?,
                         last_error            = NULL,
                         last_user_count       = ?,
                         last_course_count     = ?,
                         last_enrollment_count = ?
                     WHERE sync_key = ?
                     """)) {
            ps.setString(1, successAt.toString());
            ps.setInt(2, userCount);
            ps.setInt(3, courseCount);
            ps.setInt(4, enrollmentCount);
            ps.setString(5, SYNC_STATE_KEY);
            ps.executeUpdate();
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to record roster sync success", error);
        }
    }

    /** Record a failed sync with the error message. */
    public synchronized void recordFailure(Instant attemptAt, String errorMessage) {
        try (Connection connection = openConnection();
             PreparedStatement ps = connection.prepareStatement("""
                     UPDATE roster_sync_state
                     SET last_attempt_at = ?,
                         last_error      = ?
                     WHERE sync_key = ?
                     """)) {
            ps.setString(1, attemptAt.toString());
            ps.setString(2, abbreviate(errorMessage, 1_000));
            ps.setString(3, SYNC_STATE_KEY);
            ps.executeUpdate();
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to record roster sync failure", error);
        }
    }

    /** Read the current sync state row. Returns empty only if the table is missing (should not occur). */
    public synchronized Optional<SyncStateRecord> readSyncState() {
        try (Connection connection = openConnection();
             PreparedStatement ps = connection.prepareStatement("""
                     SELECT sync_key, last_attempt_at, last_success_at, last_error,
                            last_user_count, last_course_count, last_enrollment_count
                     FROM roster_sync_state
                     WHERE sync_key = ?
                     """)) {
            ps.setString(1, SYNC_STATE_KEY);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    return Optional.empty();
                }
                return Optional.of(new SyncStateRecord(
                        rs.getString("last_attempt_at"),
                        rs.getString("last_success_at"),
                        rs.getString("last_error"),
                        rs.getObject("last_user_count") != null ? rs.getInt("last_user_count") : null,
                        rs.getObject("last_course_count") != null ? rs.getInt("last_course_count") : null,
                        rs.getObject("last_enrollment_count") != null ? rs.getInt("last_enrollment_count") : null
                ));
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to read roster sync state", error);
        }
    }

    // -------------------------------------------------------------------------
    // Synced cloud user lookups & updates
    // -------------------------------------------------------------------------

    public synchronized Optional<SyncedUserRecord> findSyncedUserByEmail(String email) {
        try (Connection connection = openConnection();
             PreparedStatement ps = connection.prepareStatement("""
                     SELECT cloud_user_id, display_name, email, role, active, local_login_hash
                     FROM cloud_synced_users
                     WHERE lower(email) = lower(?)
                     LIMIT 1
                     """)) {
            ps.setString(1, email);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    return Optional.empty();
                }
                return Optional.of(new SyncedUserRecord(
                        rs.getString("cloud_user_id"),
                        rs.getString("display_name"),
                        rs.getString("email"),
                        rs.getString("role"),
                        rs.getInt("active") == 1,
                        rs.getString("local_login_hash")
                ));
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to look up synced user by email " + email, error);
        }
    }

    public synchronized Optional<SyncedUserRecord> findSyncedUserById(String cloudUserId) {
        try (Connection connection = openConnection();
             PreparedStatement ps = connection.prepareStatement("""
                     SELECT cloud_user_id, display_name, email, role, active, local_login_hash
                     FROM cloud_synced_users
                     WHERE cloud_user_id = ?
                     LIMIT 1
                     """)) {
            ps.setString(1, cloudUserId);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    return Optional.empty();
                }
                return Optional.of(new SyncedUserRecord(
                        rs.getString("cloud_user_id"),
                        rs.getString("display_name"),
                        rs.getString("email"),
                        rs.getString("role"),
                        rs.getInt("active") == 1,
                        rs.getString("local_login_hash")
                ));
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to look up synced user by id " + cloudUserId, error);
        }
    }

    public synchronized void updateLocalLoginHash(String cloudUserId, String passwordHash) {
        try (Connection connection = openConnection();
             PreparedStatement ps = connection.prepareStatement("""
                     UPDATE cloud_synced_users
                     SET local_login_hash = ?
                     WHERE cloud_user_id = ?
                     """)) {
          ps.setString(1, passwordHash);
          ps.setString(2, cloudUserId);
          int updated = ps.executeUpdate();
          if (updated == 0) {
              throw new IllegalArgumentException("Synced cloud user " + cloudUserId + " not found.");
          }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to update local login hash for user " + cloudUserId, error);
        }
    }

    public synchronized List<SyncedUserRecord> listSyncedUsers() {
        try (Connection connection = openConnection();
             PreparedStatement ps = connection.prepareStatement("""
                     SELECT cloud_user_id, display_name, email, role, active, local_login_hash
                     FROM cloud_synced_users
                     ORDER BY display_name ASC
                     """)) {
            List<SyncedUserRecord> users = new ArrayList<>();
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    users.add(new SyncedUserRecord(
                            rs.getString("cloud_user_id"),
                            rs.getString("display_name"),
                            rs.getString("email"),
                            rs.getString("role"),
                            rs.getInt("active") == 1,
                            rs.getString("local_login_hash")
                    ));
                }
            }
            return users;
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to list synced cloud users", error);
        }
    }

    // -------------------------------------------------------------------------
    // Inner types
    // -------------------------------------------------------------------------

    /** Snapshot of the {@code roster_sync_state} table. All fields are nullable strings/integers. */
    public record SyncStateRecord(
            String lastAttemptAt,
            String lastSuccessAt,
            String lastError,
            Integer lastUserCount,
            Integer lastCourseCount,
            Integer lastEnrollmentCount
    ) {
    }

    public record SyncedUserRecord(
            String cloudUserId,
            String displayName,
            String email,
            String role,
            boolean active,
            String localLoginHash
    ) {
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    private Connection openConnection() throws SQLException {
        return DriverManager.getConnection(jdbcUrl);
    }

    private static void ensureColumn(Connection connection, String tableName, String columnName, String definition) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("PRAGMA table_info(" + tableName + ")")) {
            try (ResultSet resultSet = statement.executeQuery()) {
                while (resultSet.next()) {
                    if (columnName.equalsIgnoreCase(resultSet.getString("name"))) {
                        return;
                    }
                }
            }
        }

        try (Statement statement = connection.createStatement()) {
            statement.executeUpdate("ALTER TABLE " + tableName + " ADD COLUMN " + columnName + " " + definition);
        }
    }

    private static String nullableInstantStr(Instant value) {
        return value == null ? null : value.toString();
    }

    private static String abbreviate(String value, int maxLength) {
        if (value == null || value.length() <= maxLength) {
            return value;
        }
        return value.substring(0, maxLength);
    }

    // -------------------------------------------------------------------------
    // Course-scoped / Classroom queries (Phase 4A)
    // -------------------------------------------------------------------------

    public synchronized List<CourseView> listCoursesForAdmin() {
        try (Connection connection = openConnection();
             PreparedStatement ps = connection.prepareStatement("""
                     SELECT cloud_course_id, course_code, title, description, instructor_cloud_user_id, active
                     FROM local_courses
                     WHERE active = 1
                     ORDER BY title ASC
                     """)) {
            List<CourseView> courses = new ArrayList<>();
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    courses.add(mapCourse(rs));
                }
            }
            return courses;
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to list active courses for admin", error);
        }
    }

    public synchronized List<CourseView> listCoursesForInstructor(String instructorId) {
        try (Connection connection = openConnection();
             PreparedStatement ps = connection.prepareStatement("""
                     SELECT c.cloud_course_id, c.course_code, c.title, c.description, c.instructor_cloud_user_id, c.active
                     FROM local_courses c
                     JOIN local_course_instructors ci ON c.cloud_course_id = ci.cloud_course_id
                     JOIN cloud_synced_users u ON ci.instructor_cloud_user_id = u.cloud_user_id
                     WHERE ci.instructor_cloud_user_id = ?
                       AND ci.active = 1
                       AND c.active = 1
                       AND u.active = 1
                     ORDER BY c.title ASC
                     """)) {
            ps.setString(1, instructorId);
            List<CourseView> courses = new ArrayList<>();
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    courses.add(mapCourse(rs));
                }
            }
            return courses;
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to list courses for instructor " + instructorId, error);
        }
    }

    public synchronized List<CourseView> listCoursesForTrainee(String traineeId) {
        try (Connection connection = openConnection();
             PreparedStatement ps = connection.prepareStatement("""
                     SELECT c.cloud_course_id, c.course_code, c.title, c.description, c.instructor_cloud_user_id, c.active
                     FROM local_courses c
                     JOIN local_course_enrollments ce ON c.cloud_course_id = ce.cloud_course_id
                     JOIN cloud_synced_users u ON ce.trainee_cloud_user_id = u.cloud_user_id
                     WHERE ce.trainee_cloud_user_id = ?
                       AND ce.active = 1
                       AND c.active = 1
                       AND u.active = 1
                     ORDER BY c.title ASC
                     """)) {
            ps.setString(1, traineeId);
            List<CourseView> courses = new ArrayList<>();
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    courses.add(mapCourse(rs));
                }
            }
            return courses;
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to list courses for trainee " + traineeId, error);
        }
    }

    public synchronized Optional<CourseView> findCourseById(String courseId) {
        try (Connection connection = openConnection();
             PreparedStatement ps = connection.prepareStatement("""
                     SELECT cloud_course_id, course_code, title, description, instructor_cloud_user_id, active
                     FROM local_courses
                     WHERE cloud_course_id = ? AND active = 1
                     LIMIT 1
                     """)) {
            ps.setString(1, courseId);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    return Optional.empty();
                }
                return Optional.of(mapCourse(rs));
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to find course by id " + courseId, error);
        }
    }


    public synchronized boolean isInstructorAssigned(String courseId, String instructorId) {
        try (Connection connection = openConnection();
             PreparedStatement ps = connection.prepareStatement("""
                     SELECT COUNT(*) AS count
                     FROM local_course_instructors ci
                     JOIN cloud_synced_users u ON ci.instructor_cloud_user_id = u.cloud_user_id
                     JOIN local_courses c ON ci.cloud_course_id = c.cloud_course_id
                     WHERE ci.cloud_course_id = ?
                       AND ci.instructor_cloud_user_id = ?
                       AND ci.active = 1
                       AND c.active = 1
                       AND u.active = 1
                     """)) {
            ps.setString(1, courseId);
            ps.setString(2, instructorId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() && rs.getInt("count") > 0;
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to check instructor assignment for course " + courseId, error);
        }
    }

    public synchronized boolean isTraineeEnrolled(String courseId, String traineeId) {
        try (Connection connection = openConnection();
             PreparedStatement ps = connection.prepareStatement("""
                     SELECT COUNT(*) AS count
                     FROM local_course_enrollments ce
                     JOIN cloud_synced_users u ON ce.trainee_cloud_user_id = u.cloud_user_id
                     JOIN local_courses c ON ce.cloud_course_id = c.cloud_course_id
                     WHERE ce.cloud_course_id = ?
                       AND ce.trainee_cloud_user_id = ?
                       AND ce.active = 1
                       AND c.active = 1
                       AND u.active = 1
                     """)) {
            ps.setString(1, courseId);
            ps.setString(2, traineeId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() && rs.getInt("count") > 0;
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to check trainee enrollment for course " + courseId, error);
        }
    }

    public synchronized List<CourseStudentView> listStudentsForCourse(String courseId) {
        try (Connection connection = openConnection();
             PreparedStatement ps = connection.prepareStatement("""
                     SELECT u.cloud_user_id, u.display_name, u.email, ce.enrolled_at
                     FROM local_course_enrollments ce
                     JOIN cloud_synced_users u ON ce.trainee_cloud_user_id = u.cloud_user_id
                     JOIN local_courses c ON ce.cloud_course_id = c.cloud_course_id
                     WHERE ce.cloud_course_id = ?
                       AND ce.active = 1
                       AND c.active = 1
                       AND u.active = 1
                     ORDER BY u.display_name ASC
                     """)) {
            ps.setString(1, courseId);
            List<CourseStudentView> students = new ArrayList<>();
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    students.add(mapStudent(rs));
                }
            }
            return students;
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to list students for course " + courseId, error);
        }
    }

    public synchronized List<CourseInstructorView> listInstructorsForCourse(String courseId) {
        try (Connection connection = openConnection();
             PreparedStatement ps = connection.prepareStatement("""
                     SELECT u.cloud_user_id, u.display_name, u.email
                     FROM local_course_instructors ci
                     JOIN cloud_synced_users u ON ci.instructor_cloud_user_id = u.cloud_user_id
                     JOIN local_courses c ON ci.cloud_course_id = c.cloud_course_id
                     WHERE ci.cloud_course_id = ?
                       AND ci.active = 1
                       AND c.active = 1
                       AND u.active = 1
                     ORDER BY u.display_name ASC
                     """)) {
            ps.setString(1, courseId);
            List<CourseInstructorView> instructors = new ArrayList<>();
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    instructors.add(mapInstructor(rs));
                }
            }
            return instructors;
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to list instructors for course " + courseId, error);
        }
    }

    public synchronized boolean existsActiveCloudUser(String cloudUserId, java.util.Set<String> allowedRoles) {
        try (Connection connection = openConnection();
             PreparedStatement ps = connection.prepareStatement("""
                     SELECT role
                     FROM cloud_synced_users
                     WHERE cloud_user_id = ?
                       AND active = 1
                     LIMIT 1
                     """)) {
            ps.setString(1, cloudUserId);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    String role = rs.getString("role");
                    return allowedRoles == null || allowedRoles.isEmpty() || allowedRoles.contains(role);
                }
                return false;
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to check active cloud user " + cloudUserId, error);
        }
    }

    public synchronized boolean existsActiveCourse(String cloudCourseId) {
        try (Connection connection = openConnection();
             PreparedStatement ps = connection.prepareStatement("""
                     SELECT COUNT(*) AS count
                     FROM local_courses
                     WHERE cloud_course_id = ?
                       AND active = 1
                     """)) {
            ps.setString(1, cloudCourseId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() && rs.getInt("count") > 0;
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to check active course " + cloudCourseId, error);
        }
    }

    public synchronized boolean isInstructorAssignedToCourse(String cloudCourseId, String instructorCloudUserId) {
        try (Connection connection = openConnection();
             PreparedStatement ps = connection.prepareStatement("""
                     SELECT COUNT(*) AS count
                     FROM (
                       SELECT cloud_course_id FROM local_courses WHERE cloud_course_id = ? AND instructor_cloud_user_id = ? AND active = 1
                       UNION ALL
                       SELECT cloud_course_id FROM local_course_instructors WHERE cloud_course_id = ? AND instructor_cloud_user_id = ? AND active = 1
                     )
                     """)) {
            ps.setString(1, cloudCourseId);
            ps.setString(2, instructorCloudUserId);
            ps.setString(3, cloudCourseId);
            ps.setString(4, instructorCloudUserId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() && rs.getInt("count") > 0;
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to check instructor assignment for course " + cloudCourseId, error);
        }
    }

    public synchronized boolean isTraineeEnrolledInCourse(String cloudCourseId, String traineeCloudUserId) {
        return isTraineeEnrolled(cloudCourseId, traineeCloudUserId);
    }

    public synchronized Optional<String> findPrimaryInstructorForCourse(String cloudCourseId) {
        try (Connection connection = openConnection();
             PreparedStatement ps = connection.prepareStatement("""
                     SELECT instructor_cloud_user_id
                     FROM local_courses
                     WHERE cloud_course_id = ?
                       AND active = 1
                     LIMIT 1
                     """)) {
            ps.setString(1, cloudCourseId);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    return Optional.ofNullable(rs.getString("instructor_cloud_user_id"));
                }
                return Optional.empty();
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to find primary instructor for course " + cloudCourseId, error);
        }
    }

    private CourseView mapCourse(ResultSet rs) throws SQLException {
        return new CourseView(
                rs.getString("cloud_course_id"),
                rs.getString("course_code"),
                rs.getString("title"),
                rs.getString("description"),
                rs.getString("instructor_cloud_user_id"),
                rs.getInt("active") == 1
        );
    }

    private CourseStudentView mapStudent(ResultSet rs) throws SQLException {
        return new CourseStudentView(
                rs.getString("cloud_user_id"),
                rs.getString("display_name"),
                rs.getString("email"),
                rs.getString("enrolled_at")
        );
    }

    private CourseInstructorView mapInstructor(ResultSet rs) throws SQLException {
        return new CourseInstructorView(
                rs.getString("cloud_user_id"),
                rs.getString("display_name"),
                rs.getString("email")
        );
    }
}
