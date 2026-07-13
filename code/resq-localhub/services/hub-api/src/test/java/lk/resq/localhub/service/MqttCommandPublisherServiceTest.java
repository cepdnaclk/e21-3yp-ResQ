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
        assertThat(result.requestId()).startsWith("req-300-a4f18d2c-");
        assertThat(result.payload()).containsEntry("request_id", result.requestId());
        assertThat(result.payload()).containsEntry("session_id", "S-100");
        assertThat(result.payload()).containsEntry("profile_id", "ChestCompressions");
        assertThat(result.payload()).containsEntry("issued_at_ms", 1704067200000L);
        assertThat(publisher.lastCommandTypeId).isEqualTo(FirmwareCommandTypeId.SESSION_START);
        assertThat(publisher.lastQos).isEqualTo(1);
        assertThat(publisher.lastRetained).isFalse();
        FirmwareCommandRequestRecord stored = repository.findCommandByRequestId(result.requestId()).orElseThrow();
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

        FirmwareCommandRequestRecord stored = repository.findCommandByRequestId(publisher.lastRequestId).orElseThrow();
        assertThat(stored.status()).isEqualTo("FAILED");
        assertThat(stored.topic()).isEqualTo(FirmwareTopics.sessionStopCommandTopic("M01"));
        assertThat(stored.publishedAt()).isNull();
        assertThat(stored.completedAt()).isNotNull();
    }

    @Test
    void publishesTelemetryControlStartCommandWithValidatedInterval() {
        FirmwarePersistenceRepository repository = newRepository();
        CapturingPublisher publisher = new CapturingPublisher(objectMapper, repository, false);

        MqttCommandPublisherService.FirmwareCommandPublishResult result =
                publisher.publishTelemetryControl("M01", "start", 200);

        assertThat(result.topic()).isEqualTo(FirmwareTopics.telemetryCommandTopic("M01"));
        assertThat(result.requestId()).startsWith("req-151-a4f18d2c-");
        assertThat(result.payload()).containsEntry("request_id", result.requestId());
        assertThat(result.payload()).containsEntry("action", "START");
        assertThat(result.payload()).containsEntry("interval_ms", 200);
        assertThat(publisher.lastCommandTypeId).isEqualTo(FirmwareCommandTypeId.TELEMETRY_CONTROL);

        FirmwareCommandRequestRecord stored = repository.findCommandByRequestId(result.requestId()).orElseThrow();
        assertThat(stored.status()).isEqualTo("PUBLISHED");
        assertThat(stored.topic()).isEqualTo(FirmwareTopics.telemetryCommandTopic("M01"));
        assertThat(stored.commandTypeId()).isEqualTo(FirmwareCommandTypeId.TELEMETRY_CONTROL.value());
    }

    @Test
    void rejectsTelemetryControlStartWithoutValidInterval() {
        FirmwarePersistenceRepository repository = newRepository();
        CapturingPublisher publisher = new CapturingPublisher(objectMapper, repository, false);

        assertThatThrownBy(() -> publisher.publishTelemetryControl("M01", "START", null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("interval_ms is required");
        assertThatThrownBy(() -> publisher.publishTelemetryControl("M01", "START", 99))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("between 100 and 1000");
        assertThatThrownBy(() -> publisher.publishTelemetryControl("M01", "START", 1001))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("between 100 and 1000");
    }

    @Test
    void publishesTelemetryControlStopWithoutIntervalOrSessionFields() {
        FirmwarePersistenceRepository repository = newRepository();
        CapturingPublisher publisher = new CapturingPublisher(objectMapper, repository, false);

        MqttCommandPublisherService.FirmwareCommandPublishResult result =
                publisher.publishTelemetryControl("M01", "stop", 200);

        assertThat(result.topic()).isEqualTo(FirmwareTopics.telemetryCommandTopic("M01"));
        assertThat(result.payload()).containsEntry("action", "STOP");
        assertThat(result.payload()).doesNotContainKeys("interval_ms", "session_id", "sessionId");
    }

    private static final class CapturingPublisher extends MqttCommandPublisherService {
        private String lastTopic;
        private String lastRequestId;
        private int lastQos = -1;
        private boolean lastRetained = true;
        private FirmwareCommandTypeId lastCommandTypeId;
        private final boolean failPublish;

        private CapturingPublisher(ObjectMapper objectMapper, FirmwarePersistenceRepository repository, boolean failPublish) {
            super(
                    objectMapper,
                    repository,
                    "tcp://127.0.0.1:1",
                    "test-publisher",
                    null,
                    null,
                    new CommandRequestIdGenerator("a4f18d2c"),
                    MqttQosPolicy.defaults()
            );
            this.failPublish = failPublish;
        }

        @Override
        protected void ensureConnected() {
        }

        @Override
        protected void publishToBroker(String topic, String jsonPayload) throws Exception {
            publishToBroker(topic, jsonPayload, 1, false);
        }

        @Override
        protected void publishToBroker(String topic, String jsonPayload, int qos, boolean retained) throws Exception {
            lastTopic = topic;
            lastQos = qos;
            lastRetained = retained;
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
            lastRequestId = String.valueOf(payload.get("request_id"));
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
