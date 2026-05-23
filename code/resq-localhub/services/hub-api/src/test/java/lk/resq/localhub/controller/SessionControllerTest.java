package lk.resq.localhub.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.model.SessionEndRequest;
import lk.resq.localhub.model.SessionEndResponse;
import lk.resq.localhub.model.SessionStartRequest;
import lk.resq.localhub.model.SessionStartResponse;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.service.ActiveSessionService;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.FirmwareCalibrationService;
import lk.resq.localhub.service.FirmwarePersistenceRepository;
import lk.resq.localhub.service.LiveStreamService;
import lk.resq.localhub.service.LocalAuthRepository;
import lk.resq.localhub.service.LocalSessionRepository;
import lk.resq.localhub.service.ManikinRegistryService;
import lk.resq.localhub.service.MqttCommandPublisherService;
import lk.resq.localhub.service.TraineeRecordsRepository;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;

import java.nio.file.Path;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class SessionControllerTest {

    @Test
    void listSessionsReturnsRicherCompletedSummary() throws Exception {
        Fixture fixture = newFixture();
        seedCompletedSession(fixture.service, "M01");

        ResponseEntity<?> response = fixture.controller.listSessions(new MockHttpServletRequest());

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        List<SessionEndResponse> sessions = requireBody(response.getBody());
        assertThat(sessions).hasSize(1);
        SessionEndResponse session = sessions.get(0);
        assertThat(session.summary().sampleCount()).isEqualTo(1);
        assertThat(session.summary().totalCompressions()).isEqualTo(1);
        assertThat(session.summary().validCompressions()).isEqualTo(1);
        assertThat(session.summary().avgDepthProgress()).isEqualTo(0.76);
    }

    @Test
    void exportSessionAliasSupportsCsvAndJson() throws Exception {
        Fixture fixture = newFixture();
        SessionEndResponse completed = seedCompletedSession(fixture.service, "M01");

        ResponseEntity<?> jsonResponse = fixture.controller.exportSession(new MockHttpServletRequest(), completed.sessionId(), "json");
        assertThat(jsonResponse.getStatusCode().is2xxSuccessful()).isTrue();
        SessionEndResponse jsonBody = requireBody(jsonResponse.getBody());
        assertThat(jsonBody.summary().sampleCount()).isEqualTo(1);

        ResponseEntity<?> csvResponse = fixture.controller.exportSession(new MockHttpServletRequest(), completed.sessionId(), "csv");
        assertThat(csvResponse.getStatusCode().is2xxSuccessful()).isTrue();
        String csvBody = requireBody(csvResponse.getBody());
        assertThat(csvBody).contains("sampleCount,totalCompressions,validCompressions,avgDepthMm,avgDepthProgress");
        assertThat(csvBody).contains("0.76");
    }

    private static SessionEndResponse seedCompletedSession(ActiveSessionService service, String deviceId) throws Exception {
        SessionStartResponse started = service.startSession(new SessionStartRequest(
                deviceId,
                null,
                null,
                null,
                "Guest",
                "Review smoke",
                null
        ));

        com.fasterxml.jackson.databind.ObjectMapper mapper = new ObjectMapper();
        service.recordTelemetry(deviceId, mapper.readTree("""
                {
                  "session_id": "%s",
                  "depth_progress": 0.76,
                  "rate_cpm": 109,
                  "compression_count": 1,
                  "recoil_ok": true,
                  "pause_s": 0.1,
                  "flags": "DEPTH_OK,RATE_OK"
                }
                """.formatted(started.sessionId())));

        return service.endSession(new SessionEndRequest(started.sessionId()));
    }

    @SuppressWarnings("unchecked")
    private static <T> T requireBody(Object body) {
        return (T) body;
    }

    private static Fixture newFixture() throws Exception {
        ObjectMapper objectMapper = new ObjectMapper();
        LocalSessionRepository sessionRepository = new LocalSessionRepository(Path.of("target", "session-controller-test-" + UUID.randomUUID() + ".sqlite").toString());
        sessionRepository.initialize();
        MqttCommandPublisherService publisher = new NoopMqttCommandPublisherService();
        ManikinRegistryService registry = new ManikinRegistryService(12);
        FirmwarePersistenceRepository firmwareRepository = new FirmwarePersistenceRepository(
                Path.of("target", "session-controller-firmware-" + UUID.randomUUID() + ".sqlite").toString()
        );
        firmwareRepository.initialize();
        FirmwareCalibrationService calibrationService = new FirmwareCalibrationService(publisher, firmwareRepository, registry);
        ActiveSessionService service = new ActiveSessionService(
                registry,
                publisher,
                sessionRepository,
                new NoopLiveStreamService(),
                new TraineeRecordsRepository(),
                calibrationService
        );
        AuthService authService = new AllowingAuthService(objectMapper);
        SessionController controller = new SessionController(service, authService, registry);
        return new Fixture(service, controller);
    }

    private record Fixture(ActiveSessionService service, SessionController controller) {
    }

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
        public void publishSessionLive(String sessionId, lk.resq.localhub.model.SessionLiveView payload) {
        }
    }

    private static final class AllowingAuthService extends AuthService {
        private static final AuthUser INSTRUCTOR = new AuthUser("user-1", "instructor", "Instructor", UserRole.INSTRUCTOR, null);

        private AllowingAuthService(ObjectMapper objectMapper) {
            super(new LocalAuthRepository(Path.of("target", "session-controller-auth-" + UUID.randomUUID() + ".sqlite").toString()), objectMapper, 8);
        }

        @Override
        public AuthUser requireAuth(HttpServletRequest request) {
            return INSTRUCTOR;
        }

        @Override
        public AuthUser requireRole(HttpServletRequest request, UserRole... allowedRoles) {
            return INSTRUCTOR;
        }

        @Override
        public Optional<AuthUser> maybeAuth(HttpServletRequest request) {
            return Optional.of(INSTRUCTOR);
        }

        @Override
        public void audit(String actorUserId, String action, String targetType, String targetId, java.util.Map<String, Object> metadata) {
        }
    }
}
