package lk.resq.localhub.service;

import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.model.roster.CourseInstructorView;
import lk.resq.localhub.model.roster.CourseStudentView;
import lk.resq.localhub.model.roster.CourseView;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class CourseAccessService {

    private final RosterCacheRepository rosterRepository;

    public CourseAccessService(RosterCacheRepository rosterRepository) {
        this.rosterRepository = rosterRepository;
    }

    public List<CourseView> getVisibleCourses(AuthUser user) {
        if (user.role() == UserRole.ADMIN) {
            return rosterRepository.listCoursesForAdmin();
        } else if (user.role() == UserRole.INSTRUCTOR) {
            return rosterRepository.listCoursesForInstructor(user.id());
        } else {
            return rosterRepository.listCoursesForTrainee(user.id());
        }
    }

    public CourseView getVisibleCourse(String courseId, AuthUser user) {
        CourseView course = rosterRepository.findCourseById(courseId)
                .orElseThrow(() -> new IllegalArgumentException("Course not found: " + courseId));

        if (isCourseVisible(courseId, user)) {
            return course;
        }

        // Return 404 (IllegalArgumentException) instead of 403 to avoid leaking existence
        throw new IllegalArgumentException("Course not found: " + courseId);
    }

    public List<CourseStudentView> getCourseStudents(String courseId, AuthUser user) {
        if (user.role() == UserRole.TRAINEE) {
            throw new ForbiddenException("Trainees are not allowed to view student rosters.");
        }

        // Validate course existence and visibility first (throws 404/IllegalArgumentException if not visible)
        getVisibleCourse(courseId, user);

        return rosterRepository.listStudentsForCourse(courseId);
    }

    public List<CourseInstructorView> getCourseInstructors(String courseId, AuthUser user) {
        // Validate course existence and visibility first
        getVisibleCourse(courseId, user);

        return rosterRepository.listInstructorsForCourse(courseId);
    }

    private boolean isCourseVisible(String courseId, AuthUser user) {
        if (user.role() == UserRole.ADMIN) {
            return true;
        } else if (user.role() == UserRole.INSTRUCTOR) {
            return rosterRepository.isInstructorAssigned(courseId, user.id());
        } else if (user.role() == UserRole.TRAINEE) {
            return rosterRepository.isTraineeEnrolled(courseId, user.id());
        }
        return false;
    }
}
