package lk.resq.localhub.controller;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import lk.resq.localhub.model.*;
import lk.resq.localhub.model.cloudsync.*;
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
import java.util.NoSuchElementException;
import java.util.UUID;
import lk.resq.localhub.model.firmware.CalibrationMqttEvent;
import lk.resq.localhub.service.DeviceReadinessService;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
class CourseSessionStartTest {
    private Path tempDbPath;
    private LocalAuthRepository authRepository;
    private RosterCacheRepository rosterRepository;
    private LocalSessionRepository sessionRepository;
    private ActiveSessionService sessionService;
    private TestAuthService authService;
    private SessionController controller;
    @BeforeEach
    void setUp() throws IOException {
        tempDbPath = Path.of("target", "course-session-start-test-" + UUID.randomUUID() + ".sqlite");
        Files.deleteIfExists(tempDbPath);
        String sqlitePath = tempDbPath.toAbsolutePath().toString();
        authRepository = new LocalAuthRepository(sqlitePath);
        authRepository.initialize();
        rosterRepository = new RosterCacheRepository(sqlitePath);
        rosterRepository.initialize();
        sessionRepository = new LocalSessionRepository(sqlitePath);
        sessionRepository.initialize();
        ObjectMapper mapper = new ObjectMapper();
        MqttCommandPublisherService publisher = new NoopMqttCommandPublisherService(mapper);
        ManikinRegistryService registry = new ManikinRegistryService(10);
        FirmwarePersistenceRepository firmwareRepository = new FirmwarePersistenceRepository(sqlitePath);
        firmwareRepository.initialize();
        CalibrationProfileRepository profileRepository = new CalibrationProfileRepository(sqlitePath);
        profileRepository.initialize();
        CalibrationProfileFingerprintService fingerprintService = new CalibrationProfileFingerprintService();
        CalibrationProfileService profileService = new CalibrationProfileService(profileRepository, fingerprintService);
        FirmwareCalibrationService calibrationService = new FirmwareCalibrationService(publisher, firmwareRepository, profileService, registry, fingerprintService);
        SyncQueueRepository syncQueueRepository = new SyncQueueRepository(sqlitePath);
        syncQueueRepository.initialize();
        SyncQueueService syncQueueService = new SyncQueueService(syncQueueRepository, mapper, new CloudSessionSummaryPayloadMapper());
        TestIdentityValidator identityValidator = new TestIdentityValidator();
        DeviceReadinessService readinessService = new DeviceReadinessService(new DeviceRuntimeStateService(), identityValidator);
        readinessService.handleCalibrationEvent("M01", new CalibrationMqttEvent(
                "M01",
                4002,
                "reply-m01",
                "ACK",
                11,
                "PASS",
                "00000",
                0,
                "READY_FOR_SESSION",
                100L,
                Instant.now(),
                "adult-basic"
        ));
        sessionService = new ActiveSessionService(
                registry,
                publisher,
                sessionRepository,
                new NoopLiveStreamService(),
                new TraineeRecordsRepository(),
                calibrationService,
                syncQueueService,
                rosterRepository,
                new lk.resq.localhub.service.RateEstimatorRegistry(),
                readinessService,
                profileService,
                fingerprintService,
                identityValidator
        );
        authService = new TestAuthService(authRepository, rosterRepository, mapper);
        controller = new SessionController(sessionService, authService, registry);
        // Seed Roster Data
        rosterRepository.upsertUser(new CloudRosterUser("u-inst-1", "Instructor 1", "inst1@example.com", "INSTRUCTOR", true, Instant.now(), null), Instant.now());
        rosterRepository.upsertUser(new CloudRosterUser("u-inst-2", "Instructor 2", "inst2@example.com", "INSTRUCTOR", true, Instant.now(), null), Instant.now());
        rosterRepository.upsertUser(new CloudRosterUser("u-train-1", "Trainee 1", "train1@example.com", "TRAINEE", true, Instant.now(), null), Instant.now());
        rosterRepository.upsertUser(new CloudRosterUser("u-train-2", "Trainee 2", "train2@example.com", "TRAINEE", true, Instant.now(), null), Instant.now());
        rosterRepository.upsertCourse(new CloudRosterCourse("c1", "RSQ-101", "Course 1", "Description 1", "u-inst-1", true, Instant.now()), Instant.now());
        rosterRepository.upsertCourse(new CloudRosterCourse("c2", "RSQ-102", "Course 2", "Description 2", "u-inst-2", true, Instant.now()), Instant.now());
        rosterRepository.upsertInstructorAssignment(new CloudRosterInstructorAssignment("c1", "u-inst-1", true), Instant.now());
        rosterRepository.upsertInstructorAssignment(new CloudRosterInstructorAssignment("c2", "u-inst-2", true), Instant.now());
        rosterRepository.upsertEnrollment(new CloudRosterEnrollment("c1", "u-train-1", true, Instant.now()), Instant.now());
        rosterRepository.upsertEnrollment(new CloudRosterEnrollment("c2", "u-train-2", true, Instant.now()), Instant.now());
    }
    @AfterEach
    void tearDown() throws IOException {
        Files.deleteIfExists(tempDbPath);
    }
    @Test
    void instructorAssignedToCourseCanStartSessionForEnrolledTrainee() {
        authService.setActiveUser(new AuthUser("u-inst-1", "inst1@example.com", "Instructor 1", UserRole.INSTRUCTOR, null));
        SessionStartRequest req = new SessionStartRequest("M01", "u-train-1", "c1", null, null, null, "adult-basic", "Scenario", "Notes");
        ResponseEntity<?> response = controller.startSession(new MockHttpServletRequest(), req);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        SessionStartResponse body = (SessionStartResponse) response.getBody();
        assertThat(body).isNotNull();
        assertThat(body.courseId()).isEqualTo("c1");
        assertThat(body.traineeId()).isEqualTo("u-train-1");
        assertThat(body.instructorId()).isEqualTo("u-inst-1");
    }
    @Test
    void instructorCannotStartSessionForUnassignedCourse() {
        authService.setActiveUser(new AuthUser("u-inst-1", "inst1@example.com", "Instructor 1", UserRole.INSTRUCTOR, null));
        // inst-1 trying to start session in course c2 (assigned to inst-2)
        SessionStartRequest req = new SessionStartRequest("M01", "u-train-2", "c2", null, null, null, "adult-basic", "Scenario", "Notes");
        ResponseEntity<?> response = controller.startSession(new MockHttpServletRequest(), req);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }
    @Test
    void instructorCannotStartSessionForTraineeNotEnrolledInCourse() {
        authService.setActiveUser(new AuthUser("u-inst-1", "inst1@example.com", "Instructor 1", UserRole.INSTRUCTOR, null));
        // inst-1 assigned to c1, but train-2 is enrolled in c2 (not c1)
        SessionStartRequest req = new SessionStartRequest("M01", "u-train-2", "c1", null, null, null, "adult-basic", "Scenario", "Notes");
        ResponseEntity<?> response = controller.startSession(new MockHttpServletRequest(), req);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }
    @Test
    void traineeCannotStartSession() {
        authService.setActiveUser(new AuthUser("u-train-1", "train1@example.com", "Trainee 1", UserRole.TRAINEE, null));
        SessionStartRequest req = new SessionStartRequest("M01", "u-train-1", "c1", null, null, null, "adult-basic", "Scenario", "Notes");
        ResponseEntity<?> response = controller.startSession(new MockHttpServletRequest(), req);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }
    @Test
    void adminCanStartSessionForEnrolledTrainee() {
        authService.setActiveUser(new AuthUser("admin-id", "admin@example.com", "Admin", UserRole.ADMIN, null));
        SessionStartRequest req = new SessionStartRequest("M01", "u-train-1", "c1", null, null, null, "adult-basic", "Scenario", "Notes");
        ResponseEntity<?> response = controller.startSession(new MockHttpServletRequest(), req);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        SessionStartResponse body = (SessionStartResponse) response.getBody();
        assertThat(body.courseId()).isEqualTo("c1");
        assertThat(body.instructorId()).isEqualTo("admin-id");
    }
    @Test
    void missingCourseIdOrTraineeIdIsRejected() {
        authService.setActiveUser(new AuthUser("u-inst-1", "inst1@example.com", "Instructor 1", UserRole.INSTRUCTOR, null));
        // Missing courseId
        SessionStartRequest reqNoCourse = new SessionStartRequest("M01", "u-train-1", null, null, null, null, "adult-basic", "Scenario", "Notes");
        ResponseEntity<?> resNoCourse = controller.startSession(new MockHttpServletRequest(), reqNoCourse);
        assertThat(resNoCourse.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        // Missing traineeId
        SessionStartRequest reqNoTrainee = new SessionStartRequest("M01", null, "c1", null, null, null, "adult-basic", "Scenario", "Notes");
        ResponseEntity<?> resNoTrainee = controller.startSession(new MockHttpServletRequest(), reqNoTrainee);
        assertThat(resNoTrainee.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }
    @Test
    void missingOrInactiveCourseReturns404() {
        authService.setActiveUser(new AuthUser("admin-id", "admin@example.com", "Admin", UserRole.ADMIN, null));
        SessionStartRequest req = new SessionStartRequest("M01", "u-train-1", "nonexistent-course", null, null, null, "adult-basic", "Scenario", "Notes");
        ResponseEntity<?> response = controller.startSession(new MockHttpServletRequest(), req);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }
    @Test
    void oldSessionRowsWithNullCourseIdRemainReadable() {
        // Seed old session directly into database
        SessionSummary summary = new SessionSummary(
                "old-session-1", "M01", "u-train-1", Instant.now().minusSeconds(100), Instant.now(),
                100, 10, 5, 5, 50.0, 1.0, 100.0, 100.0, 10, 0, 0, 100, null
        );
        SessionEndResponse oldSession = new SessionEndResponse(
                "old-session-1", "M01", "u-train-1", Instant.now().minusSeconds(100), true, Instant.now(),
                "Scenario", "Notes", summary, null, null
        );
        sessionRepository.save(oldSession);
        var loaded = sessionRepository.findById("old-session-1").orElse(null);
        assertThat(loaded).isNotNull();
        assertThat(loaded.courseId()).isNull();
        assertThat(loaded.instructorId()).isNull();
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
        public AuthUser requireRole(HttpServletRequest request, UserRole... allowedRoles) {
            if (activeUser == null) {
                throw new UnauthorizedException("Unauthenticated");
            }
            for (UserRole r : allowedRoles) {
                if (activeUser.role() == r) {
                    return activeUser;
                }
            }
            throw new ForbiddenException("Access denied");
        }
        @Override
        public void audit(String actorUserId, String action, String targetType, String targetId, java.util.Map<String, Object> metadata) {
        }
    }
    private static final class NoopMqttCommandPublisherService extends MqttCommandPublisherService {
        private NoopMqttCommandPublisherService(ObjectMapper mapper) {
            super(mapper, "tcp://127.0.0.1:1", "test");
        }
        @Override
        public void publishSessionStart(SessionStartCommandPayload payload) {
        }
        @Override
        public void publishSessionStop(SessionStopCommandPayload payload) {
        }
    }
    private static final class NoopLiveStreamService extends LiveStreamService {
        @Override
        public void publishSessionLive(String sessionId, SessionLiveView payload) {
        }
    }
}
