package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.localhub.model.firmware.FirmwareCommandTypeId;
import lk.resq.localhub.model.firmware.FirmwareTopics;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class MqttCommandPublisherServiceTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void publishesCanonicalSessionStartCommandWithRequestId() {
        CapturingPublisher publisher = new CapturingPublisher(objectMapper);

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
    }

    @Test
    void publishesLegacySessionStopThroughCanonicalFirmwareTopic() {
        CapturingPublisher publisher = new CapturingPublisher(objectMapper);

        MqttCommandPublisherService.FirmwareCommandPublishResult result = publisher.publishSessionStopCommand(
                "M01",
                "S-100",
                Instant.parse("2024-01-01T00:05:00Z")
        );

        assertThat(result.topic()).isEqualTo(FirmwareTopics.sessionStopCommandTopic("M01"));
        assertThat(result.requestId()).isEqualTo("req-301-0001");
        assertThat(result.payload()).containsEntry("request_id", "req-301-0001");
        assertThat(result.payload()).containsEntry("session_id", "S-100");
        assertThat(result.payload()).containsEntry("issued_at_ms", 1704067500000L);
        assertThat(publisher.lastTopic).isEqualTo(FirmwareTopics.sessionStopCommandTopic("M01"));
    }

    private static final class CapturingPublisher extends MqttCommandPublisherService {
        private String lastTopic;
        private FirmwareCommandTypeId lastCommandTypeId;

        private CapturingPublisher(ObjectMapper objectMapper) {
            super(objectMapper, "tcp://127.0.0.1:1", "test-publisher");
        }

        @Override
        protected FirmwareCommandPublishResult publishFirmwareCommand(
                String topic,
                Map<String, Object> payload,
                String action,
                FirmwareCommandTypeId commandTypeId
        ) {
            lastTopic = topic;
            lastCommandTypeId = commandTypeId;
            return new FirmwareCommandPublishResult(topic, String.valueOf(payload.get("request_id")), payload);
        }
    }
}
