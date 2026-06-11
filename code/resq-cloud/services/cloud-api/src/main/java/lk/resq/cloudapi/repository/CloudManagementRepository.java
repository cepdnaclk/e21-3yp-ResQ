package lk.resq.cloudapi.repository;

import lk.resq.cloudapi.model.CloudCourse;
import lk.resq.cloudapi.model.CloudEnrollment;
import lk.resq.cloudapi.model.CloudUser;
import lk.resq.cloudapi.model.CloudUserCredentials;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface CloudManagementRepository {

    CloudUser insertUser(CloudUser user, String passwordHash, Instant passwordUpdatedAt);

    CloudUser updateUser(CloudUser user);

    Optional<CloudUser> findUserById(String userId);

    Optional<CloudUser> findUserByEmail(String email);

    Optional<CloudUserCredentials> findUserCredentialsById(String userId);

    Optional<CloudUserCredentials> findUserCredentialsByEmail(String email);

    boolean existsAdminUser();

    void updatePassword(String userId, String passwordHash, Instant passwordUpdatedAt);

    void updateLastLogin(String userId, Instant lastLoginAt);

    void updateLocalLoginHash(String userId, String localLoginHash);

    List<CloudUser> findAllUsers();

    List<lk.resq.cloudapi.model.CloudRosterUser> findAllRosterUsers();

    CloudCourse insertCourse(CloudCourse course);

    CloudCourse updateCourse(CloudCourse course);

    Optional<CloudCourse> findCourseById(String courseId);

    Optional<CloudCourse> findCourseByCode(String courseCode);

    List<CloudCourse> findAllCourses();

    CloudEnrollment saveEnrollment(CloudEnrollment enrollment);

    Optional<CloudEnrollment> findEnrollment(String courseId, String traineeId);

    List<CloudEnrollment> findCourseEnrollments(String courseId);

    void deactivateEnrollment(String courseId, String traineeId);
}
