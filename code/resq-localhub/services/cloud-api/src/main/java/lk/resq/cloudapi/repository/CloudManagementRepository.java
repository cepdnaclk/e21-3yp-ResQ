package lk.resq.cloudapi.repository;

import lk.resq.cloudapi.model.CloudCourse;
import lk.resq.cloudapi.model.CloudEnrollment;
import lk.resq.cloudapi.model.CloudUser;

import java.util.List;
import java.util.Optional;

public interface CloudManagementRepository {

    CloudUser insertUser(CloudUser user);

    CloudUser updateUser(CloudUser user);

    Optional<CloudUser> findUserById(String userId);

    Optional<CloudUser> findUserByEmail(String email);

    List<CloudUser> findAllUsers();

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
