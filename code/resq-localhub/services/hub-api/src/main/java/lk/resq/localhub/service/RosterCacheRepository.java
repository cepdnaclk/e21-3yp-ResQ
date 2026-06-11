package lk.resq.localhub.service;

import jakarta.annotation.PostConstruct;
import lk.resq.localhub.model.cloudsync.CloudRosterCourse;
import lk.resq.localhub.model.cloudsync.CloudRosterEnrollment;
import lk.resq.localhub.model.cloudsync.CloudRosterInstructorAssignment;
import lk.resq.localhub.model.cloudsync.CloudRosterUser;
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
                       (cloud_user_id, display_name, email, role, active, updated_at, last_synced_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT(cloud_user_id) DO UPDATE SET
                       display_name   = excluded.display_name,
                       email          = excluded.email,
                       role           = excluded.role,
                       active         = excluded.active,
                       updated_at     = excluded.updated_at,
                       last_synced_at = excluded.last_synced_at
                     """)) {
            ps.setString(1, user.cloudUserId());
            ps.setString(2, user.displayName());
            ps.setString(3, user.email());
            ps.setString(4, user.role());
            ps.setInt(5, user.active() ? 1 : 0);
            ps.setString(6, nullableInstantStr(user.updatedAt()));
            ps.setString(7, syncedAt.toString());
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

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    private Connection openConnection() throws SQLException {
        return DriverManager.getConnection(jdbcUrl);
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
}
