package lk.resq.localhub.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.model.SessionLiveView;
import lk.resq.localhub.model.ManikinLiveSummary;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.ActiveSessionService;
import lk.resq.localhub.service.CalibrationStreamService;
import lk.resq.localhub.service.DeviceReadinessService;
import lk.resq.localhub.service.DeviceRuntimeStateService;
import lk.resq.localhub.service.CalibrationProfileIdentityValidator;
import lk.resq.localhub.service.TestIdentityValidator;
import lk.resq.localhub.service.ForbiddenException;
import lk.resq.localhub.service.LiveStreamService;
import lk.resq.localhub.service.LocalAuthRepository;
import lk.resq.localhub.service.ManikinRegistryService;
import lk.resq.localhub.service.SensorStreamService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

class LiveStreamControllerTest {

    private CalibrationStreamService calibrationStreamService;
    private SensorStreamService sensorStreamService;
    private AllowingAuthService authService;
    private DummyActiveSessionService sessionService;
    private LiveStreamController controller;

    @BeforeEach
    void setUp() {
        ObjectMapper objectMapper = new ObjectMapper();
        
        LiveStreamService liveStreamService = new DummyLiveStreamService();
        ManikinRegistryService registryService = new DummyManikinRegistryService();
        sessionService = new DummyActiveSessionService();
        TestIdentityValidator identityValidator = new TestIdentityValidator();
        DeviceReadinessService readinessService = new DeviceReadinessService(new DeviceRuntimeStateService(), identityValidator);
        calibrationStreamService = new CalibrationStreamService(readinessService);
        sensorStreamService = new SensorStreamService();
        
        authService = new AllowingAuthService(objectMapper);
        controller = new LiveStreamController(
                liveStreamService,
                registryService,
                sessionService,
                authService,
                calibrationStreamService,
                sensorStreamService
        );
    }

    @Test
    void streamCalibrationReturnsOkAndSseEmitter() {
        ResponseEntity<SseEmitter> response = controller.streamCalibration(null, "M01");
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isNotNull();
    }

    @Test
    void streamCalibrationReturnsForbiddenForInvalidRole() {
        authService.setAllowedRole(UserRole.TRAINEE);

        ResponseEntity<SseEmitter> response = controller.streamCalibration(null, "M01");
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(response.getBody()).isNull();
    }

    @Test
    void streamSensorStreamReturnsOkAndSseEmitter() {
        ResponseEntity<SseEmitter> response = controller.streamSensorStream(null, "M01");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isNotNull();
        assertThat(sensorStreamService.subscriberCount("M01")).isEqualTo(1);
    }

    @Test
    void streamManikinsLiveSubscribesWithInitialSnapshot() throws Exception {
        DummyLiveStreamService liveStreamService = new DummyLiveStreamService();
        DummyManikinRegistryService registryService = new DummyManikinRegistryService();
        registryService.updateFromStatus("M-DEV", new ObjectMapper().readTree("""
                {
                  "device_id": "M-DEV",
                  "state": "PAIRED_IDLE",
                  "session_active": false,
                  "ip": "192.168.8.161",
                  "ts_ms": 5324
                }
                """));

        LiveStreamController liveController = new LiveStreamController(
                liveStreamService,
                registryService,
                sessionService,
                authService,
                calibrationStreamService,
                sensorStreamService
        );

        ResponseEntity<SseEmitter> response = liveController.streamManikinsLive(null);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isNotNull();
        assertThat(liveStreamService.initialInstructorSnapshots).hasSize(1);
        assertThat(liveStreamService.initialInstructorSnapshots.get(0))
                .extracting(ManikinLiveSummary::deviceId)
                .containsExactly("M-DEV");
    }

    @Test
    void streamManikinsLiveReturnsForbiddenForTraineeAndAuditsDeniedAccess() {
        authService.setAllowedRole(UserRole.TRAINEE);

        ResponseEntity<SseEmitter> response = controller.streamManikinsLive(null);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(authService.auditEvents).contains("ACCESS_DENIED:stream:manikins_live");
    }

    @Test
    void streamSessionLiveReturnsForbiddenForNonOwningTrainee() {
        authService.setCurrentUser(new AuthUser("trainee-2", "trainee-2", "Trainee Two", UserRole.TRAINEE, null));
        sessionService.setLiveView(new SessionLiveView(
                "session-1",
                "M01",
                "M01",
                "trainee-1",
                true,
                Instant.now(),
                "scenario",
                "notes",
                Instant.now(),
                "ACTIVE",
                true,
                null,
                null,
                null,
                null,
                true,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                1L,
                "CONNECTED",
                false,
                false
        ));

        ResponseEntity<SseEmitter> response = controller.streamSessionLive(null, "session-1");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(authService.auditEvents).contains("ACCESS_DENIED:stream:session_live");
    }

    @Test
    void streamSessionLiveReturnsOkForAdmin() {
        authService.setAllowedRole(UserRole.ADMIN);
        sessionService.setLiveView(new SessionLiveView(
                "session-2",
                "M01",
                "M01",
                "trainee-1",
                true,
                Instant.now(),
                "scenario",
                "notes",
                Instant.now(),
                "ACTIVE",
                true,
                null,
                null,
                null,
                null,
                true,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                1L,
                "CONNECTED",
                false,
                false
        ));

        ResponseEntity<SseEmitter> response = controller.streamSessionLive(null, "session-2");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isNotNull();
    }

    private static final class DummyLiveStreamService extends LiveStreamService {
        private final List<List<ManikinLiveSummary>> initialInstructorSnapshots = new ArrayList<>();

        private DummyLiveStreamService() {
            super();
        }

        @Override
        public SseEmitter subscribeInstructor(List<ManikinLiveSummary> initialPayload) {
            initialInstructorSnapshots.add(initialPayload);
            return new SseEmitter(0L);
        }
    }

    private static final class DummyManikinRegistryService extends ManikinRegistryService {
        private DummyManikinRegistryService() {
            super(12);
        }
    }

    private static final class DummyActiveSessionService extends ActiveSessionService {
        private SessionLiveView liveView;

        private DummyActiveSessionService() {
            super(null, null, null, null, null, null, null, null, null, null);
        }

        @Override
        public ManikinLiveSummary decorateLiveSummary(ManikinLiveSummary summary) {
            return summary;
        }

        @Override
        public java.util.Optional<SessionLiveView> getSessionLiveView(String sessionId) {
            return java.util.Optional.ofNullable(liveView);
        }

        public void setLiveView(SessionLiveView liveView) {
            this.liveView = liveView;
        }
    }

    private static final class AllowingAuthService extends AuthService {
        private UserRole role = UserRole.INSTRUCTOR;
        private AuthUser currentUser = new AuthUser("user-1", "user-1", "Instructor/Admin", UserRole.INSTRUCTOR, null);
        private final List<String> auditEvents = new ArrayList<>();

        private AllowingAuthService(ObjectMapper objectMapper) {
            super(
                    new LocalAuthRepository(Path.of("target", "livestream-controller-auth-test-" + UUID.randomUUID() + ".sqlite").toString()),
                    objectMapper,
                    8
            );
        }

        public void setAllowedRole(UserRole role) {
            this.role = role;
            this.currentUser = new AuthUser("user-1", "user-1", "Instructor/Admin", role, null);
        }

        public void setCurrentUser(AuthUser currentUser) {
            this.currentUser = currentUser;
        }

        @Override
        public AuthUser requireRole(HttpServletRequest request, UserRole... allowedRoles) {
            boolean allowed = false;
            for (UserRole r : allowedRoles) {
                if (r == this.role) {
                    allowed = true;
                    break;
                }
            }
            if (!allowed) {
                throw new ForbiddenException("Access Denied");
            }
            return currentUser;
        }

        @Override
        public AuthUser requireAuth(HttpServletRequest request) {
            return currentUser;
        }

        @Override
        public java.util.Optional<AuthUser> maybeAuth(HttpServletRequest request) {
            return java.util.Optional.ofNullable(currentUser);
        }

        @Override
        public void audit(String actorUserId, String action, String targetType, String targetId, Map<String, Object> metadata) {
            auditEvents.add(action + ":" + targetType + ":" + targetId);
        }
    }
}
