package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

class MqttSubscriberServiceTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void parsesCanonicalAndLegacyFirmwareTopics() throws Exception {
        MqttSubscriberService service = newService();

        assertThat(service.parseTopic("resq/M01/status")).isNotNull();
        assertThat(service.parseTopic("resq/M01/status").messageType()).isEqualTo("status");
        assertThat(service.parseTopic("resq/M01/events/calibration").messageType()).isEqualTo("events/calibration");
        assertThat(service.parseTopic("resq/M01/events/error").messageType()).isEqualTo("events/error");
        assertThat(service.parseTopic("resq/manikins/M01/live").messageType()).isEqualTo("telemetry");
        assertThat(service.parseTopic("resq/manikins/M01/events").messageType()).isEqualTo("events");
        assertThat(service.parseTopic("resq/manikins/M01/events/calibration").messageType()).isEqualTo("events/calibration");
        assertThat(service.parseTopic("other/M01/status")).isNull();
    }

    private MqttSubscriberService newService() throws Exception {
        ManikinRegistryService registry = new ManikinRegistryService(12);
        MqttCommandPublisherService commandPublisher = new NoopMqttCommandPublisherService();
        LocalSessionRepository sessionRepository = new InMemoryLocalSessionRepository();
        LiveStreamService liveStreamService = new NoopLiveStreamService();
        TraineeRecordsRepository traineeRecordsRepository = new TraineeRecordsRepository();
        ActiveSessionService activeSessionService = new ActiveSessionService(
                registry,
                commandPublisher,
                sessionRepository,
                liveStreamService,
                traineeRecordsRepository
        );

        return new MqttSubscriberService(
                objectMapper,
                registry,
                activeSessionService,
                liveStreamService,
                "tcp://127.0.0.1:1",
                "test-subscriber",
                null,
                null
        );
    }

    private static final class NoopMqttCommandPublisherService extends MqttCommandPublisherService {
        private NoopMqttCommandPublisherService() {
            super(new ObjectMapper(), "tcp://127.0.0.1:1", "test");
        }
    }

    private static final class InMemoryLocalSessionRepository extends LocalSessionRepository {
        private InMemoryLocalSessionRepository() {
            super("target/mqtt-subscriber-service-test.sqlite");
        }

        @Override
        public synchronized void save(lk.resq.localhub.model.SessionEndResponse session) {
        }

        @Override
        public synchronized Optional<lk.resq.localhub.model.SessionEndResponse> findById(String sessionId) {
            return Optional.empty();
        }

        @Override
        public synchronized List<lk.resq.localhub.model.SessionEndResponse> findAll() {
            return List.of();
        }
    }

    private static final class NoopLiveStreamService extends LiveStreamService {
        @Override
        public void publishSessionLive(String sessionId, lk.resq.localhub.model.SessionLiveView payload) {
        }
    }
}
