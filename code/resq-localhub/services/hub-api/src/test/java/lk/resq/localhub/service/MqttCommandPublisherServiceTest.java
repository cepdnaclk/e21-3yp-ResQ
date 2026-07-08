package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.localhub.model.firmware.FirmwareCommandRequestRecord;
import lk.resq.localhub.model.firmware.FirmwareCommandTypeId;
import lk.resq.localhub.model.firmware.FirmwareTopics;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.file.Path;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MqttCommandPublisherServiceTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @BeforeEach
    void clearState() {
    }

    @Test
    void publishesCanonicalSessionStartCommandWithRequestId() {
        FirmwarePersistenceRepository repository = newRepository();
        CapturingPublisher publisher = new CapturingPublisher(objectMapper, repository, false);

        MqttCommandPublisherService.FirmwareCommandPublishResult result = publisher.publishSessionStartCommand(
                "M01",
                "S-100",
                "ChestCompressions",
                Instant.parse("2024-01-01T00:00:00Z")
        );

        assertThat(result.topic()).isEqualTo(FirmwareTopics.sessionStartCommandTopic("M01"));
        assertThat(result.requestId()).isEqualTo("req-300-0001");
        assertThat(result.payload()).containsEntry("request_id", "req-300-0001");
        assertThat(result.payload()).containsEntry("session_id", "S-100");
        assertThat(result.payload()).containsEntry("profile_id", "ChestCompressions");
        assertThat(result.payload()).containsEntry("issued_at_ms", 1704067200000L);
        assertThat(publisher.lastCommandTypeId).isEqualTo(FirmwareCommandTypeId.SESSION_START);
        FirmwareCommandRequestRecord stored = repository.findCommandByRequestId("req-300-0001").orElseThrow();
        assertThat(stored.status()).isEqualTo("PUBLISHED");
        assertThat(stored.topic()).isEqualTo(FirmwareTopics.sessionStartCommandTopic("M01"));
        assertThat(stored.deviceId()).isEqualTo("M01");
        assertThat(stored.publishedAt()).isNotNull();
        assertThat(stored.createdAt()).isNotNull();
        assertThat(stored.lastUpdatedAt()).isNotNull();
    }

    @Test
    void marksCommandFailedWhenPublishThrows() {
        FirmwarePersistenceRepository repository = newRepository();
        CapturingPublisher publisher = new CapturingPublisher(objectMapper, repository, true);

        assertThatThrownBy(() -> publisher.publishSessionStopCommand(
                "M01",
                "S-100",
                Instant.parse("2024-01-01T00:05:00Z")
        )).isInstanceOf(MqttCommandPublishException.class);

        FirmwareCommandRequestRecord stored = repository.findCommandByRequestId("req-301-0001").orElseThrow();
        assertThat(stored.status()).isEqualTo("FAILED");
        assertThat(stored.topic()).isEqualTo(FirmwareTopics.sessionStopCommandTopic("M01"));
        assertThat(stored.publishedAt()).isNull();
        assertThat(stored.completedAt()).isNotNull();
    }

    @Test
    void publishesTelemetryControlCommandWithClampedInterval() {
        FirmwarePersistenceRepository repository = newRepository();
        CapturingPublisher publisher = new CapturingPublisher(objectMapper, repository, false);

        MqttCommandPublisherService.FirmwareCommandPublishResult result =
                publisher.publishTelemetryControl("M01", "start", 25);

        assertThat(result.topic()).isEqualTo(FirmwareTopics.telemetryCommandTopic("M01"));
        assertThat(result.requestId()).isEqualTo("req-151-0001");
        assertThat(result.payload()).containsEntry("request_id", "req-151-0001");
        assertThat(result.payload()).containsEntry("action", "START");
        assertThat(result.payload()).containsEntry("interval_ms", 50);
        assertThat(publisher.lastCommandTypeId).isEqualTo(FirmwareCommandTypeId.TELEMETRY_CONTROL);

        FirmwareCommandRequestRecord stored = repository.findCommandByRequestId("req-151-0001").orElseThrow();
        assertThat(stored.status()).isEqualTo("PUBLISHED");
        assertThat(stored.topic()).isEqualTo(FirmwareTopics.telemetryCommandTopic("M01"));
        assertThat(stored.commandTypeId()).isEqualTo(FirmwareCommandTypeId.TELEMETRY_CONTROL.value());
    }

    private static final class CapturingPublisher extends MqttCommandPublisherService {
        private String lastTopic;
        private FirmwareCommandTypeId lastCommandTypeId;
        private final boolean failPublish;

        private CapturingPublisher(ObjectMapper objectMapper, FirmwarePersistenceRepository repository, boolean failPublish) {
            super(objectMapper, repository, "tcp://127.0.0.1:1", "test-publisher");
            this.failPublish = failPublish;
        }

        @Override
        protected void ensureConnected() {
        }

        @Override
        protected void publishToBroker(String topic, String jsonPayload) throws Exception {
            lastTopic = topic;
            if (failPublish) {
                throw new IllegalStateException("forced publish failure");
            }
        }

        @Override
        protected FirmwareCommandPublishResult publishFirmwareCommand(
                String topic,
                Map<String, Object> payload,
                String action,
                FirmwareCommandTypeId commandTypeId
        ) {
            lastCommandTypeId = commandTypeId;
            return super.publishFirmwareCommand(topic, payload, action, commandTypeId);
        }
    }

    private static FirmwarePersistenceRepository newRepository() {
        FirmwarePersistenceRepository repository = new FirmwarePersistenceRepository(
                Path.of("target", "firmware-command-test-" + UUID.randomUUID() + ".sqlite").toString()
        );
        repository.initialize();
        return repository;
    }
}
