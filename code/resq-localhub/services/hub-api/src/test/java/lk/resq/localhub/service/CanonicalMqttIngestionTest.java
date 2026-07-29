package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.localhub.model.ingestion.MqttTopicFamily;
import lk.resq.localhub.model.ingestion.TelemetryMode;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;

class CanonicalMqttIngestionTest {
    private static final Instant RECEIVED_AT = Instant.parse("2026-07-28T08:30:00Z");
    private final CanonicalMqttIngestion ingestion = new CanonicalMqttIngestion(
            new ObjectMapper(),
            Clock.fixed(RECEIVED_AT, ZoneOffset.UTC)
    );

    @Test
    void normalizesCanonicalAndLegacyTopicsToOneCanonicalIdentity() {
        var canonical = parse("resq/M01/status", "{}");
        var legacy = parse("resq/manikins/M01/status", "{}");

        assertThat(canonical.canonicalDeviceId()).isEqualTo("M01");
        assertThat(canonical.canonicalTopic()).isEqualTo("resq/M01/status");
        assertThat(canonical.legacyTopicUsed()).isFalse();
        assertThat(legacy.canonicalDeviceId()).isEqualTo("M01");
        assertThat(legacy.canonicalTopic()).isEqualTo("resq/M01/status");
        assertThat(legacy.legacyTopicUsed()).isTrue();
    }

    @Test
    void identifiesEveryTopicFamily() {
        assertThat(parse("resq/M01/status", "{}").topicFamily()).isEqualTo(MqttTopicFamily.STATUS);
        assertThat(parse("resq/M01/heartbeat", "{}").topicFamily()).isEqualTo(MqttTopicFamily.HEARTBEAT);
        assertThat(parse("resq/M01/telemetry", "{}").topicFamily()).isEqualTo(MqttTopicFamily.TELEMETRY);
        assertThat(parse("resq/M01/debug", "{}").topicFamily()).isEqualTo(MqttTopicFamily.DEBUG);
        assertThat(parse("resq/M01/events", "{}").topicFamily()).isEqualTo(MqttTopicFamily.EVENT);
        assertThat(parse("resq/M01/events/calibration", "{}").topicFamily()).isEqualTo(MqttTopicFamily.CALIBRATION_EVENT);
        assertThat(parse("resq/M01/events/error", "{}").topicFamily()).isEqualTo(MqttTopicFamily.ERROR_EVENT);
    }

    @Test
    void preservesOptionalIdentityTimestampsOrderingAndSessionMetadata() {
        var envelope = parse("resq/M01/telemetry", """
                {
                  "device_id": "M01",
                  "session_id": "S01",
                  "state": "SESSION_ACTIVE",
                  "ts_ms": 4521,
                  "boot_id": "boot-a",
                  "state_seq": 17
                }
                """);

        assertThat(envelope.telemetryMode()).isEqualTo(TelemetryMode.SESSION_ACTIVE);
        assertThat(envelope.firmwareTimestampMs()).isEqualTo(4521L);
        assertThat(envelope.backendReceivedAt()).isEqualTo(RECEIVED_AT);
        assertThat(envelope.bootId()).isEqualTo("boot-a");
        assertThat(envelope.stateSequence()).isEqualTo(17L);
        assertThat(envelope.sessionId()).isEqualTo("S01");
        assertThat(envelope.normalizedPayload().get("device_id").asText()).isEqualTo("M01");
    }

    @Test
    void acceptsMissingPayloadIdentityAndClassifiesSensorStream() {
        var envelope = parse("resq/manikins/M01/live", """
                {"telemetry_mode":"SENSOR_STREAM","ts_ms":99}
                """);

        assertThat(envelope.canonicalDeviceId()).isEqualTo("M01");
        assertThat(envelope.telemetryMode()).isEqualTo(TelemetryMode.SENSOR_STREAM);
        assertThat(envelope.validationResult().accepted()).isTrue();
    }

    @Test
    void classifiesCalibrationAndErrorEvents() {
        assertThat(parse("resq/M01/events/calibration", "{}").telemetryMode())
                .isEqualTo(TelemetryMode.CALIBRATION);
        assertThat(parse("resq/M01/events/error", "{}").telemetryMode())
                .isEqualTo(TelemetryMode.ERROR);
    }

    @Test
    void rejectsMalformedTopicAndJson() {
        assertThat(ingestion.parse("resq/M01/status/extra", bytes("{}")).validationResult().reasonCode())
                .isEqualTo("MALFORMED_TOPIC");
        assertThat(ingestion.parse("resq//status", bytes("{}")).validationResult().reasonCode())
                .isEqualTo("MALFORMED_TOPIC");
        assertThat(ingestion.parse("resq/M01/status", bytes("{oops")).validationResult().reasonCode())
                .isEqualTo("MALFORMED_JSON");
        assertThat(ingestion.parse("resq/M01/status", bytes("[]")).validationResult().reasonCode())
                .isEqualTo("MALFORMED_JSON");
    }

    @Test
    void rejectsConflictingSessionDiscriminators() {
        var result = ingestion.parse(
                "resq/M01/telemetry",
                bytes("{\"telemetry_mode\":\"SESSION_ACTIVE\",\"state\":\"SENSOR_STREAM\"}")
        );

        assertThat(result.accepted()).isFalse();
        assertThat(result.envelope().canonicalDeviceId()).isEqualTo("M01");
        assertThat(result.validationResult().reasonCode()).isEqualTo("CONFLICTING_TELEMETRY_MODE");
    }

    private lk.resq.localhub.model.ingestion.MqttIngestionEnvelope parse(String topic, String json) {
        var result = ingestion.parse(topic, bytes(json));
        assertThat(result.accepted()).isTrue();
        return result.envelope();
    }

    private static byte[] bytes(String value) {
        return value.getBytes(StandardCharsets.UTF_8);
    }
}
