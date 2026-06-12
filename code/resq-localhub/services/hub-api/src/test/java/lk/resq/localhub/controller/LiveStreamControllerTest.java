package lk.resq.localhub.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.model.SessionLiveView;
import lk.resq.localhub.model.SessionStartRequest;
import lk.resq.localhub.model.SessionStartResponse;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.service.ActiveSessionService;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.CalibrationProfileRepository;
import lk.resq.localhub.service.CalibrationProfileService;
import lk.resq.localhub.service.FirmwareCalibrationService;
import lk.resq.localhub.service.FirmwarePersistenceRepository;
import lk.resq.localhub.service.LiveStreamService;
import lk.resq.localhub.service.LocalAuthRepository;
import lk.resq.localhub.service.LocalSessionRepository;
import lk.resq.localhub.service.ManikinRegistryService;
import lk.resq.localhub.service.MqttCommandPublisherService;
import lk.resq.localhub.service.SyncQueueRepository;
import lk.resq.localhub.service.SyncQueueService;
import lk.resq.localhub.service.TraineeRecordsRepository;
import lk.resq.localhub.service.ForbiddenException;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.nio.file.Path;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class LiveStreamControllerTest {

    private final ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();

    @Test
    void streamSessionLiveAllowsTraineeToAccessOwnSession() throws Exception {
        Fixture fixture = newFixture("trainee-bob", UserRole.TRAINEE);
        
        SessionStartResponse started = fixture.service.startSession(new SessionStartRequest(
                "M01",
                "trainee-bob",
                null,
                null,
                null,
                "smoke-test",
                null
        ));

        ResponseEntity<SseEmitter> response = fixture.controller.streamSessionLive(new MockHttpServletRequest(), started.sessionId());
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isNotNull();
    }

    @Test
    void streamSessionLiveDeniesTraineeAccessToOtherSession() throws Exception {
        Fixture fixture = newFixture("trainee-bob", UserRole.TRAINEE);
        
        SessionStartResponse started = fixture.service.startSession(new SessionStartRequest(
                "M01",
                "trainee-alice",
                null,
                null,
                null,
                "smoke-test",
                null
        ));

        ResponseEntity<SseEmitter> response = fixture.controller.streamSessionLive(new MockHttpServletRequest(), started.sessionId());
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    void streamSessionLiveReturns404IfSessionDoesNotExist() throws Exception {
        Fixture fixture = newFixture("trainee-bob", UserRole.TRAINEE);

        ResponseEntity<SseEmitter> response = fixture.controller.streamSessionLive(new MockHttpServletRequest(), "non-existent-session");
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void streamSessionLiveAllowsAdminToAccessAnySession() throws Exception {
        Fixture fixture = newFixture("admin-user", UserRole.ADMIN);
        
        SessionStartResponse started = fixture.service.startSession(new SessionStartRequest(
                "M01",
                "trainee-alice",
                null,
                null,
                null,
                "smoke-test",
                null
        ));

        ResponseEntity<SseEmitter> response = fixture.controller.streamSessionLive(new MockHttpServletRequest(), started.sessionId());
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isNotNull();
    }

    private Fixture newFixture(String actorUsername, UserRole actorRole) throws Exception {
        LocalSessionRepository sessionRepository = new LocalSessionRepository(Path.of("target", "stream-controller-test-" + UUID.randomUUID() + ".sqlite").toString());
        sessionRepository.initialize();
        MqttCommandPublisherService publisher = new NoopMqttCommandPublisherService();
        ManikinRegistryService registry = new ManikinRegistryService(12);
        FirmwarePersistenceRepository firmwareRepository = new FirmwarePersistenceRepository(
                Path.of("target", "stream-controller-firmware-" + UUID.randomUUID() + ".sqlite").toString()
        );
        firmwareRepository.initialize();
        CalibrationProfileRepository profileRepository = new CalibrationProfileRepository(
            Path.of("target", "stream-controller-profile-" + UUID.randomUUID() + ".sqlite").toString()
        );
        profileRepository.initialize();
        CalibrationProfileService profileService = new CalibrationProfileService(profileRepository);
        FirmwareCalibrationService calibrationService = new FirmwareCalibrationService(publisher, firmwareRepository, profileService, registry);
        SyncQueueRepository syncQueueRepository = new SyncQueueRepository(Path.of("target", "stream-controller-sync-" + UUID.randomUUID() + ".sqlite").toString());
        syncQueueRepository.initialize();
        SyncQueueService syncQueueService = new SyncQueueService(
                syncQueueRepository,
                objectMapper,
                new lk.resq.localhub.service.CloudSessionSummaryPayloadMapper()
        );
        ActiveSessionService service = new ActiveSessionService(
                registry,
                publisher,
                sessionRepository,
                new NoopLiveStreamService(),
                new TraineeRecordsRepository(),
            calibrationService,
            syncQueueService
        );
        AuthService authService = new AllowingAuthService(objectMapper, actorUsername, actorRole);
        LiveStreamService liveStreamService = new NoopLiveStreamService();
        LiveStreamController controller = new LiveStreamController(liveStreamService, registry, service, authService);
        return new Fixture(service, controller);
    }

    private record Fixture(ActiveSessionService service, LiveStreamController controller) {}

    private static final class NoopMqttCommandPublisherService extends MqttCommandPublisherService {
        private NoopMqttCommandPublisherService() {
            super(new ObjectMapper(), "tcp://127.0.0.1:1", "test");
        }

        @Override
        public void publishSessionStart(lk.resq.localhub.model.SessionStartCommandPayload payload) {
        }

        @Override
        public void publishSessionStop(lk.resq.localhub.model.SessionStopCommandPayload payload) {
        }
    }

    private static final class NoopLiveStreamService extends LiveStreamService {
        @Override
        public SseEmitter subscribeSession(String sessionId, SessionLiveView initialPayload) {
            return new SseEmitter();
        }
    }

    private static final class AllowingAuthService extends AuthService {
        private final AuthUser actor;

        private AllowingAuthService(ObjectMapper objectMapper, String username, UserRole role) {
            super(new LocalAuthRepository(Path.of("target", "stream-controller-auth-" + UUID.randomUUID() + ".sqlite").toString()), objectMapper, 8);
            this.actor = new AuthUser("user-1", username, "Test User", role, null);
        }

        @Override
        public AuthUser requireAuth(HttpServletRequest request) {
            return actor;
        }

        @Override
        public AuthUser requireRole(HttpServletRequest request, UserRole... allowedRoles) {
            if (actor.role() == UserRole.ADMIN) return actor;
            for (UserRole role : allowedRoles) {
                if (role == actor.role()) return actor;
            }
            throw new ForbiddenException("Access Denied");
        }

        @Override
        public Optional<AuthUser> maybeAuth(HttpServletRequest request) {
            return Optional.of(actor);
        }

        @Override
        public void audit(String actorUserId, String action, String targetType, String targetId, java.util.Map<String, Object> metadata) {
        }
    }
}
