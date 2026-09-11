package lk.resq.localhub.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.model.cloudsync.*;
import lk.resq.localhub.model.roster.*;
import lk.resq.localhub.service.*;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CourseControllerTest {

    private Path tempDbPath;
    private LocalAuthRepository authRepository;
    private RosterCacheRepository rosterRepository;
    private CourseAccessService courseAccessService;
    private TestAuthService authService;
    private CourseController controller;

    @BeforeEach
    void setUp() throws IOException {
        tempDbPath = Path.of("target", "course-controller-test-" + UUID.randomUUID() + ".sqlite");
        Files.deleteIfExists(tempDbPath);

        String sqlitePath = tempDbPath.toAbsolutePath().toString();

        authRepository = new LocalAuthRepository(sqlitePath);
        authRepository.initialize();

        rosterRepository = new RosterCacheRepository(sqlitePath);
        rosterRepository.initialize();

        courseAccessService = new CourseAccessService(rosterRepository);
        authService = new TestAuthService(authRepository, rosterRepository, new ObjectMapper());
        controller = new CourseController(courseAccessService, authService);

        // Seed data:
        // Users
        rosterRepository.upsertUser(new CloudRosterUser("u-inst-1", "Instructor 1", "inst1@example.com", "INSTRUCTOR", true, Instant.now(), null), Instant.now());
        rosterRepository.upsertUser(new CloudRosterUser("u-inst-2", "Instructor 2", "inst2@example.com", "INSTRUCTOR", true, Instant.now(), null), Instant.now());
        rosterRepository.upsertUser(new CloudRosterUser("u-train-1", "Trainee 1", "train1@example.com", "TRAINEE", true, Instant.now(), null), Instant.now());
        rosterRepository.upsertUser(new CloudRosterUser("u-train-2", "Trainee 2", "train2@example.com", "TRAINEE", true, Instant.now(), null), Instant.now());
        
        // Inactive user to verify active filtering
        rosterRepository.upsertUser(new CloudRosterUser("u-inactive", "Inactive User", "inactive@example.com", "TRAINEE", false, Instant.now(), null), Instant.now());

        // Courses (c1: active, c2: active, c3: inactive)
        rosterRepository.upsertCourse(new CloudRosterCourse("c1", "RSQ-101", "Course 1", "Description 1", "u-inst-1", true, Instant.now()), Instant.now());
        rosterRepository.upsertCourse(new CloudRosterCourse("c2", "RSQ-102", "Course 2", "Description 2", "u-inst-2", true, Instant.now()), Instant.now());
        rosterRepository.upsertCourse(new CloudRosterCourse("c3", "RSQ-103", "Course 3", "Description 3", "u-inst-1", false, Instant.now()), Instant.now());

        // Instructor Assignments (inst-1 on c1 active, inst-2 on c2 active, inst-1 on c3 active)
        rosterRepository.upsertInstructorAssignment(new CloudRosterInstructorAssignment("c1", "u-inst-1", true), Instant.now());
        rosterRepository.upsertInstructorAssignment(new CloudRosterInstructorAssignment("c2", "u-inst-2", true), Instant.now());
        rosterRepository.upsertInstructorAssignment(new CloudRosterInstructorAssignment("c3", "u-inst-1", true), Instant.now());

        // Trainee Enrollments (train-1 on c1 active, train-2 on c2 active, inactive trainee on c1 active)
        rosterRepository.upsertEnrollment(new CloudRosterEnrollment("c1", "u-train-1", true, Instant.now()), Instant.now());
        rosterRepository.upsertEnrollment(new CloudRosterEnrollment("c2", "u-train-2", true, Instant.now()), Instant.now());
        rosterRepository.upsertEnrollment(new CloudRosterEnrollment("c1", "u-inactive", true, Instant.now()), Instant.now());
    }

    @AfterEach
    void tearDown() throws IOException {
        Files.deleteIfExists(tempDbPath);
    }

    @Test
    void unauthenticatedReturns401() {
        authService.setActiveUser(null);
        assertThatThrownBy(() -> controller.listCourses(new MockHttpServletRequest()))
                .isInstanceOf(UnauthorizedException.class);
    }

    @SuppressWarnings("unchecked")
    @Test
    void adminCanListAllActiveCourses() {
        authService.setActiveUser(new AuthUser("admin-id", "admin@example.com", "Admin", UserRole.ADMIN, null));
        ResponseEntity<?> response = controller.listCourses(new MockHttpServletRequest());
        
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        List<CourseView> courses = (List<CourseView>) response.getBody();
        // Should only see c1 and c2 (active). c3 is inactive.
        assertThat(courses).hasSize(2);
        assertThat(courses).extracting(CourseView::cloudCourseId).containsExactlyInAnyOrder("c1", "c2");
    }

    @Test
    void adminCanViewAnyCourse() {
        authService.setActiveUser(new AuthUser("admin-id", "admin@example.com", "Admin", UserRole.ADMIN, null));
        ResponseEntity<?> response = controller.getCourse(new MockHttpServletRequest(), "c1");
        
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        CourseView course = (CourseView) response.getBody();
        assertThat(course.cloudCourseId()).isEqualTo("c1");
    }

    @SuppressWarnings("unchecked")
    @Test
    void instructorCanListOnlyAssignedCourses() {
        authService.setActiveUser(new AuthUser("u-inst-1", "inst1@example.com", "Instructor 1", UserRole.INSTRUCTOR, null));
        ResponseEntity<?> response = controller.listCourses(new MockHttpServletRequest());
        
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        List<CourseView> courses = (List<CourseView>) response.getBody();
        // Should see only c1 (active + assigned). c3 is assigned but inactive, c2 is active but not assigned to inst-1.
        assertThat(courses).hasSize(1);
        assertThat(courses.get(0).cloudCourseId()).isEqualTo("c1");
    }

    @Test
    void instructorCannotViewUnassignedCourse() {
        authService.setActiveUser(new AuthUser("u-inst-1", "inst1@example.com", "Instructor 1", UserRole.INSTRUCTOR, null));
        ResponseEntity<?> response = controller.getCourse(new MockHttpServletRequest(), "c2");
        
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @SuppressWarnings("unchecked")
    @Test
    void traineeCanListOnlyEnrolledCourses() {
        authService.setActiveUser(new AuthUser("u-train-1", "train1@example.com", "Trainee 1", UserRole.TRAINEE, null));
        ResponseEntity<?> response = controller.listCourses(new MockHttpServletRequest());
        
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        List<CourseView> courses = (List<CourseView>) response.getBody();
        // Should see only c1.
        assertThat(courses).hasSize(1);
        assertThat(courses.get(0).cloudCourseId()).isEqualTo("c1");
    }

    @Test
    void traineeCannotViewUnenrolledCourse() {
        authService.setActiveUser(new AuthUser("u-train-1", "train1@example.com", "Trainee 1", UserRole.TRAINEE, null));
        ResponseEntity<?> response = controller.getCourse(new MockHttpServletRequest(), "c2");
        
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @SuppressWarnings("unchecked")
    @Test
    void instructorCanListStudentsForAssignedCourse() {
        authService.setActiveUser(new AuthUser("u-inst-1", "inst1@example.com", "Instructor 1", UserRole.INSTRUCTOR, null));
        ResponseEntity<?> response = controller.getCourseStudents(new MockHttpServletRequest(), "c1");
        
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        List<CourseStudentView> students = (List<CourseStudentView>) response.getBody();
        // Should see train-1. Inactive trainee (u-inactive) must be filtered out!
        assertThat(students).hasSize(1);
        assertThat(students.get(0).cloudUserId()).isEqualTo("u-train-1");
    }

    @Test
    void traineeCannotListStudents() {
        authService.setActiveUser(new AuthUser("u-train-1", "train1@example.com", "Trainee 1", UserRole.TRAINEE, null));
        assertThatThrownBy(() -> controller.getCourseStudents(new MockHttpServletRequest(), "c1"))
                .isInstanceOf(ForbiddenException.class);
    }

    @SuppressWarnings("unchecked")
    @Test
    void traineeCanListInstructorsForEnrolledCourse() {
        authService.setActiveUser(new AuthUser("u-train-1", "train1@example.com", "Trainee 1", UserRole.TRAINEE, null));
        ResponseEntity<?> response = controller.getCourseInstructors(new MockHttpServletRequest(), "c1");
        
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        List<CourseInstructorView> instructors = (List<CourseInstructorView>) response.getBody();
        assertThat(instructors).hasSize(1);
        assertThat(instructors.get(0).cloudUserId()).isEqualTo("u-inst-1");
    }

    private static final class TestAuthService extends AuthService {
        private AuthUser activeUser;

        private TestAuthService(LocalAuthRepository authRepository, RosterCacheRepository rosterRepository, ObjectMapper objectMapper) {
            super(authRepository, rosterRepository, objectMapper, 8);
        }

        public void setActiveUser(AuthUser user) {
            this.activeUser = user;
        }

        @Override
        public AuthUser requireAuth(HttpServletRequest request) {
            if (activeUser == null) {
                throw new UnauthorizedException("Unauthenticated");
            }
            return activeUser;
        }

        @Override
        public void audit(String actorUserId, String action, String targetType, String targetId, java.util.Map<String, Object> metadata) {
        }
    }
}
