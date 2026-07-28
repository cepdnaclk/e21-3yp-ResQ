package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.localhub.model.LiveMetricPayload;
import lk.resq.localhub.model.ManikinLiveSummary;
import org.junit.jupiter.api.Test;

import java.lang.reflect.RecordComponent;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MinimalMqttContractFixtureTest {

    private static final Path FIXTURE_PATH = Path.of(
            "..", "..", "docs", "telemetry-api-update", "fixtures", "minimal-mqtt-contract-fixtures.json"
    );

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void validatesMinimalAndLegacySessionTelemetry() throws Exception {
        JsonNode fixtures = fixtures();
        Set<String> requiredFamilies = Set.of(
                "status",
                "heartbeat",
                "sessionTelemetry",
                "sensorStream",
                "debugSnapshot",
                "commandResult",
                "calibrationProgress",
                "calibrationResult",
                "errorEvent"
        );

        var minimal = TelemetryPayloadNormalizer.normalize(
                fixtures.at("/minimal/sessionTelemetry"), "M-CONTRACT"
        );
        var legacy = TelemetryPayloadNormalizer.normalize(
                fixtures.at("/legacyFull/sessionTelemetry"), "M-CONTRACT"
        );

        assertThat(minimal.ok()).isTrue();
        assertThat(minimal.value().deviceId()).isEqualTo("M-CONTRACT");
        assertThat(minimal.value().sessionId()).isEqualTo("S-001");
        assertThat(minimal.value().tsMs()).isEqualTo(123456L);
        assertThat(legacy.ok()).isTrue();
        assertThat(legacy.value().sessionId()).isEqualTo("S-LEGACY");
        assertThat(fieldNames(fixtures.path("minimal"))).containsExactlyInAnyOrderElementsOf(requiredFamilies);
        assertThat(fieldNames(fixtures.path("legacyFull"))).containsExactlyInAnyOrderElementsOf(requiredFamilies);
    }

    @Test
    void acceptsOptionalPayloadDeviceIdAndRejectsMismatch() throws Exception {
        JsonNode payload = fixtures().at("/minimal/sessionTelemetry");
        assertThat(payload.has("device_id")).isFalse();
        assertThat(TelemetryPayloadNormalizer.normalize(payload, "M-CONTRACT").ok()).isTrue();

        JsonNode mismatch = payload.deepCopy();
        ((com.fasterxml.jackson.databind.node.ObjectNode) mismatch).put("device_id", "M-OTHER");
        assertThat(TelemetryPayloadNormalizer.normalize(mismatch, "M-CONTRACT").ok()).isFalse();
    }

    @Test
    void keepsFirmwareTimestampAsUptimeAndBackendReceiptAsWallClock() throws Exception {
        JsonNode payload = fixtures().at("/minimal/sensorStream");
        Instant receivedAt = Instant.parse("2026-07-28T05:00:00Z");
        var snapshot = new SensorStreamService().parseSnapshot("M-CONTRACT", payload, receivedAt);

        assertThat(snapshot.tsMs()).isEqualTo(123456L);
        assertThat(snapshot.receivedAt()).isEqualTo(receivedAt);
        assertThat(snapshot.receivedAt().toEpochMilli()).isGreaterThan(1_000_000_000_000L);
    }

    @Test
    void separatesSensorDebugAndCalibrationPacketsFromSessionTelemetry() throws Exception {
        JsonNode fixtures = fixtures();
        assertThat(fixtures.at("/minimal/sensorStream/telemetry_mode").asText()).isEqualTo("SENSOR_STREAM");
        assertThat(fixtures.at("/minimal/debugSnapshot/source").asText()).isEqualTo("DIRECT_SENSOR_SNAPSHOT");
        assertThat(fixtures.at("/minimal/calibrationProgress/event_id").asInt()).isEqualTo(4001);
        assertThat(fixtures.at("/minimal/calibrationResult/event_id").asInt()).isEqualTo(4002);

        var snapshot = new SensorStreamService().parseSnapshot(
                "M-CONTRACT", fixtures.at("/minimal/sensorStream"), Instant.now()
        );
        assertThat(snapshot.telemetryMode()).isEqualTo("SENSOR_STREAM");
    }

    @Test
    void validatesDepthBooleanAndFlagsConsistency() throws Exception {
        assertThat(depthFlagsConsistent(fixtures().at("/minimal/sessionTelemetry"))).isTrue();
        assertThat(depthFlagsConsistent(fixtures().at("/invalid/contradictoryDepthFlags"))).isFalse();
    }

    @Test
    void locksPressureBalanceAsCenterednessScoreWithRangeValidation() throws Exception {
        JsonNode valid = fixtures().at("/minimal/sessionTelemetry");
        JsonNode invalid = fixtures().at("/invalid/outOfRangePressureBalance");

        assertThat(valid.path("pressure_balance_pct").asDouble()).isBetween(0.0, 100.0);
        assertThat(valid.path("pressure_balance_pct").asDouble()).isGreaterThanOrEqualTo(88.0);
        assertThat(valid.path("hand_placement").asText()).isEqualTo("CENTER");

        var result = TelemetryPayloadNormalizer.normalize(invalid, "M-CONTRACT");
        assertThat(result.ok()).isFalse();
        assertThat(result.reason()).contains("pressureBalanceScorePct");
    }

    @Test
    void validatesCorrelationAndConditionalSessionRules() throws Exception {
        JsonNode fixtures = fixtures();
        assertThat(fixtures.at("/minimal/commandResult/reply_id").asText()).isEqualTo("req-001");
        assertThat(fixtures.at("/minimal/calibrationProgress/reply_id").asText()).isEqualTo("req-cal-001");
        assertThat(fixtures.at("/minimal/calibrationResult/reply_id").asText()).isEqualTo("req-cal-001");

        assertThat(fixtures.at("/minimal/status/session_active").asBoolean()).isFalse();
        assertThat(fixtures.at("/minimal/status").has("session_id")).isFalse();
        assertThat(fixtures.at("/legacyFull/status/session_active").asBoolean()).isTrue();
        assertThat(fixtures.at("/legacyFull/status/session_id").asText()).isNotBlank();
        assertThat(fixtures.at("/invalid/missingActiveSessionId").has("session_id")).isFalse();
    }

    @Test
    void inventoriesCurrentPublicDtoCoverageAndDebugRawRemoval() throws Exception {
        JsonNode fixtures = fixtures();
        Set<String> liveFields = recordFields(ManikinLiveSummary.class);
        Set<String> metricFields = recordFields(LiveMetricPayload.class);

        fixtures.at("/publicDtoCoverage/ordinaryLiveRequired").forEach(field ->
                assertThat(liveFields).contains(field.asText())
        );
        fixtures.at("/publicDtoCoverage/sessionMetricRequired").forEach(field ->
                assertThat(metricFields).contains(field.asText())
        );
        assertThat(metricFields).doesNotContain("debugRaw");
        assertThat(fixtures.at("/publicDtoCoverage/pendingRemoval")).isEmpty();
    }

    @Test
    void rejectsMalformedSensorStreamShape() throws Exception {
        JsonNode payload = fixtures().at("/minimal/sensorStream").deepCopy();
        ((com.fasterxml.jackson.databind.node.ObjectNode) payload).remove("hall_progress");

        assertThatThrownBy(() -> new SensorStreamService().parseSnapshot("M-CONTRACT", payload, Instant.now()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("hall_progress");
    }

    private JsonNode fixtures() throws Exception {
        return objectMapper.readTree(FIXTURE_PATH.toFile());
    }

    private static Set<String> recordFields(Class<?> type) {
        return Arrays.stream(type.getRecordComponents())
                .map(RecordComponent::getName)
                .collect(Collectors.toSet());
    }

    private static Set<String> fieldNames(JsonNode node) {
        Set<String> names = new HashSet<>();
        node.fieldNames().forEachRemaining(names::add);
        return Set.copyOf(names);
    }

    private static boolean depthFlagsConsistent(JsonNode payload) {
        if (!payload.has("depth_ok") || !payload.has("flags")) {
            return true;
        }
        boolean depthOk = payload.path("depth_ok").asBoolean();
        boolean flagDepthOk = Arrays.stream(payload.path("flags").asText().split(","))
                .map(String::trim)
                .anyMatch("DEPTH_OK"::equals);
        return depthOk == flagDepthOk;
    }
}
