package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.localhub.model.SessionEndRequest;
import lk.resq.localhub.model.SessionEndResponse;
import lk.resq.localhub.model.SessionStartRequest;
import lk.resq.localhub.model.SessionStartResponse;
import lk.resq.localhub.model.SessionStartCommandPayload;
import lk.resq.localhub.model.SessionStopCommandPayload;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

class ActiveSessionServiceTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void validatesTelemetryAgainstActiveSessionAndDeviceBinding() throws Exception {
        ActiveSessionService service = newService();
        SessionStartResponse session = service.startSession(new SessionStartRequest(
                "M01",
                null,
                null,
                null,
                "Guest",
                "Validation smoke",
                null
        ));

        JsonNode valid = telemetry("M01", session.sessionId(), 1, 52, 110);
        ActiveSessionService.TelemetryValidationResult accepted = service.validateTelemetryBinding("M01", valid);
        assertThat(accepted.accepted()).isTrue();
        assertThat(accepted.sessionId()).isEqualTo(session.sessionId());
        assertThat(accepted.deviceId()).isEqualTo("M01");

        assertRejected(service.validateTelemetryBinding("M01", telemetry("M01", "S-WRONG", 1, 52, 110)), "session is not active");
        assertRejected(service.validateTelemetryBinding("M02", valid), "payload deviceId does not match MQTT topic deviceId");
        assertRejected(service.validateTelemetryBinding("M01", telemetryWithoutSession("M01")), "payload sessionId is missing");
        assertRejected(service.validateTelemetryBinding("M01", telemetry("M01", session.sessionId(), 2, -1, 110)), "depthMm is outside");
        assertRejected(service.validateTelemetryBinding("M01", objectMapper.readTree("""
                {
                  "deviceId": "M01",
                  "sessionId": "%s"
                }
                """.formatted(session.sessionId()))), "recognized metric fields");
    }

    @Test
    void rejectsEndedSessionAndNonIncreasingSeq() throws Exception {
        ActiveSessionService service = newService();
        SessionStartResponse session = service.startSession(new SessionStartRequest(
                "M01",
                null,
                null,
                null,
                "Guest",
                "Validation smoke",
                null
        ));

        JsonNode first = telemetry("M01", session.sessionId(), 1, 52, 110);
        service.recordTelemetry("M01", first);

        assertRejected(service.validateTelemetryBinding("M01", telemetry("M01", session.sessionId(), 1, 53, 111)), "seq is not newer");

        service.endSession(new SessionEndRequest(session.sessionId()));
        assertRejected(service.validateTelemetryBinding("M01", telemetry("M01", session.sessionId(), 2, 54, 112)), "session is not active");
    }

    private ActiveSessionService newService() throws Exception {
        MqttCommandPublisherService commandPublisher = new NoopMqttCommandPublisherService();
        LocalSessionRepository sessionRepository = new InMemoryLocalSessionRepository();
        LiveStreamService liveStreamService = new NoopLiveStreamService();
        TraineeRecordsRepository traineeRecordsRepository = new TraineeRecordsRepository();
        ManikinRegistryService registry = new ManikinRegistryService(12);
        return new ActiveSessionService(
                registry,
                commandPublisher,
                sessionRepository,
                liveStreamService,
                traineeRecordsRepository
        );
    }

    private JsonNode telemetry(String deviceId, String sessionId, long seq, double depthMm, double rateCpm) throws Exception {
        return objectMapper.readTree("""
                {
                  "deviceId": "%s",
                  "sessionId": "%s",
                  "seq": %d,
                  "depthMm": %.1f,
                  "rateCpm": %.1f,
                  "recoilOk": true,
                  "pauseS": 0.2,
                  "compressionCount": 1,
                  "handPlacement": "CENTER",
                  "flags": ["DEPTH_OK"]
                }
                """.formatted(deviceId, sessionId, seq, depthMm, rateCpm));
    }

    private JsonNode telemetryWithoutSession(String deviceId) throws Exception {
        return objectMapper.readTree("""
                {
                  "deviceId": "%s",
                  "seq": 1,
                  "depthMm": 52,
                  "rateCpm": 110
                }
                """.formatted(deviceId));
    }

    private void assertRejected(ActiveSessionService.TelemetryValidationResult result, String reasonFragment) {
        assertThat(result.accepted()).isFalse();
        assertThat(result.reason()).contains(reasonFragment);
    }

    private static final class NoopMqttCommandPublisherService extends MqttCommandPublisherService {
        private NoopMqttCommandPublisherService() {
            super(new ObjectMapper(), "tcp://127.0.0.1:1", "test");
        }

        @Override
        public void publishSessionStart(SessionStartCommandPayload payload) {
        }

        @Override
        public void publishSessionStop(SessionStopCommandPayload payload) {
        }
    }

    private static final class InMemoryLocalSessionRepository extends LocalSessionRepository {
        private SessionEndResponse lastSaved;

        private InMemoryLocalSessionRepository() {
            super("target/active-session-service-test.sqlite");
        }

        @Override
        public synchronized void save(SessionEndResponse session) {
            lastSaved = session;
        }

        @Override
        public synchronized Optional<SessionEndResponse> findById(String sessionId) {
            return lastSaved != null && lastSaved.sessionId().equals(sessionId) ? Optional.of(lastSaved) : Optional.empty();
        }

        @Override
        public synchronized List<SessionEndResponse> findAll() {
            return lastSaved == null ? List.of() : List.of(lastSaved);
        }
    }

    private static final class NoopLiveStreamService extends LiveStreamService {
        @Override
        public void publishSessionLive(String sessionId, lk.resq.localhub.model.SessionLiveView payload) {
        }
    }
}
