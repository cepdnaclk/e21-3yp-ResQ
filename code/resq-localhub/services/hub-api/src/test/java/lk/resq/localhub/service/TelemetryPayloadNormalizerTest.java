package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class TelemetryPayloadNormalizerTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void normalizesFirmwareStyleTelemetryPayloads() throws Exception {
        var payload = objectMapper.readTree("""
                {
                  "deviceId": "M01",
                  "sessionId": "S-FW-1",
                  "depth_mm": 54.25,
                  "rate_cpm": 112,
                  "depth_ok": true,
                  "pause_s": 0.3,
                  "valid_compression_count": 16,
                  "hand_placement": "CENTER",
                  "quality_flags": ["DEPTH_OK", "RATE_OK"],
                  "source_mode": "calibration",
                  "ts_ms": 12345
                }
                """);

        TelemetryPayloadNormalizer.TelemetryNormalizationResult result = TelemetryPayloadNormalizer.normalize(payload);

        assertThat(result.ok()).isTrue();
        assertThat(result.warnings()).isEmpty();
        assertThat(result.value().depthMm()).isEqualTo(54.25);
        assertThat(result.value().depthProgress()).isNull();
        assertThat(result.value().depthOk()).isTrue();
        assertThat(result.value().rateCpm()).isEqualTo(112.0);
        assertThat(result.value().recoilOk()).isNull();
        assertThat(result.value().compressionCount()).isNull();
        assertThat(result.value().validCompressionCount()).isEqualTo(16);
        assertThat(result.value().handPlacement()).isEqualTo("CENTER");
        assertThat(result.value().sourceMode()).isEqualTo("calibration");
    }

    @Test
    void acceptsCanonicalFirmwareTelemetryWithoutPayloadDeviceIdWhenTopicDeviceIdExists() throws Exception {
        var payload = objectMapper.readTree("""
                {
                  "session_id": "S-FW-2",
                  "state": "SESSION_ACTIVE",
                  "depth_mm": 42.9,
                  "depth_progress": 0.78,
                  "depth_ok": true,
                  "rate_cpm": 111,
                  "compression_count": 1,
                  "valid_compression_count": 0,
                  "recoil_ok": true,
                  "recoil_ok_count": 0,
                  "incomplete_recoil_count": 0,
                  "pause_s": 0.2,
                  "hand_placement": "CENTER",
                  "pressure_balance_score_pct": 92.9,
                  "pressure_balance_pct": 92.9,
                  "flags": "DEPTH_OK,RATE_OK,RECOIL_OK",
                  "ts_ms": 100432
                }
                """);

        TelemetryPayloadNormalizer.TelemetryNormalizationResult result =
                TelemetryPayloadNormalizer.normalize(payload, "M01");

        assertThat(result.ok()).isTrue();
        assertThat(result.value().deviceId()).isEqualTo("M01");
        assertThat(result.value().sessionId()).isEqualTo("S-FW-2");
        assertThat(result.value().depthMm()).isEqualTo(42.9);

        assertThat(result.value().depthProgress()).isEqualTo(0.78);
        assertThat(result.value().depthOk()).isTrue();
        assertThat(result.value().rateCpm()).isEqualTo(111.0);
        assertThat(result.value().recoilOk()).isTrue();
        assertThat(result.value().compressionCount()).isEqualTo(1);
        assertThat(result.value().validCompressionCount()).isZero();
        assertThat(result.value().recoilOkCount()).isZero();
        assertThat(result.value().incompleteRecoilCount()).isZero();
        assertThat(result.value().handPlacement()).isEqualTo("CENTER");
        assertThat(result.value().pressureBalanceScorePct()).isEqualTo(92.9);
        assertThat(result.value().flags()).isEqualTo("DEPTH_OK,RATE_OK,RECOIL_OK");
        assertThat(result.value().tsMs()).isEqualTo(100432L);
    }

    @Test
    void rejectsTelemetryWhenPayloadDeviceIdConflictsWithTopicDeviceId() throws Exception {
        var payload = objectMapper.readTree("""
                {
                  "device_id": "M02",
                  "session_id": "S-FW-3",
                  "depth_progress": 0.8,
                  "rate_cpm": 110,
                  "depth_ok": true
                }
                """);

        TelemetryPayloadNormalizer.TelemetryNormalizationResult result =
                TelemetryPayloadNormalizer.normalize(payload, "M01");

        assertThat(result.ok()).isFalse();
        assertThat(result.reason()).isEqualTo("payload deviceId does not match MQTT topic deviceId");
    }

    @Test
    void keepsFirmwareDepthMmSeparateFromDepthProgressWhenBothExist() throws Exception {
        var payload = objectMapper.readTree("""
                {
                  "session_id": "S-FW-4",
                  "depth_mm": 49.5,
                  "depth_progress": 0.9,
                  "rate_cpm": 109
                }
                """);

        TelemetryPayloadNormalizer.TelemetryNormalizationResult result =
                TelemetryPayloadNormalizer.normalize(payload, "M01");

        assertThat(result.ok()).isTrue();
        assertThat(result.value().depthMm()).isEqualTo(49.5);
        assertThat(result.value().depthProgress()).isEqualTo(0.9);
    }

    @Test
    void mapsHallDepthSourceForPressureDegradedTelemetry() throws Exception {
        var payload = objectMapper.readTree("""
                {
                  "session_id": "S-HALL-1",
                  "depth_progress": 0.64,
                  "depth_source": "HALL",
                  "rate_cpm": 109,
                  "pressure_valid": false,
                  "pressure_degraded": true
                }
                """);

        TelemetryPayloadNormalizer.TelemetryNormalizationResult result =
                TelemetryPayloadNormalizer.normalize(payload, "M01");

        assertThat(result.ok()).isTrue();
        assertThat(result.value().sourceMode()).isEqualTo("hall");
    }

    @Test
    void keepsLegacyCurrentDeltaAndFeedbackCompatibility() throws Exception {
        var payload = objectMapper.readTree("""
                {
                  "deviceId": "M01",
                  "sessionId": "S-LEGACY-1",
                  "current_delta": 48.5,
                  "feedback": "PERFECT",
                  "rateCpm": 108,
                  "pauseS": 0.2
                }
                """);

        TelemetryPayloadNormalizer.TelemetryNormalizationResult result = TelemetryPayloadNormalizer.normalize(payload);

        assertThat(result.ok()).isTrue();
        assertThat(result.value().depthMm()).isEqualTo(48.5);
        assertThat(result.value().depthProgress()).isNull();
        assertThat(result.value().flags()).isEqualTo("DEPTH_OK,RATE_OK,RECOIL_OK");
    }

    @Test
    void normalizesCanonicalLegacyAndMatchingPressureFields() throws Exception {
        var canonical = TelemetryPayloadNormalizer.normalize(objectMapper.readTree("""
                {"device_id":"M01","session_id":"S1","depth_mm":50,"pressure_balance_score_pct":88}
                """));
        var legacy = TelemetryPayloadNormalizer.normalize(objectMapper.readTree("""
                {"device_id":"M01","session_id":"S1","depth_mm":50,"pressure_balance_pct":88}
                """));
        var matching = TelemetryPayloadNormalizer.normalize(objectMapper.readTree("""
                {
                  "device_id":"M01",
                  "session_id":"S1",
                  "depth_mm":50,
                  "pressure_balance_score_pct":88.0,
                  "pressure_balance_pct":88.01
                }
                """));

        assertThat(canonical.value().pressureBalanceScorePct()).isEqualTo(88.0);
        assertThat(legacy.value().pressureBalanceScorePct()).isEqualTo(88.0);
        assertThat(legacy.warnings()).contains("normalized legacy pressure_balance_pct alias");
        assertThat(matching.ok()).isTrue();
        assertThat(matching.value().pressureBalanceScorePct()).isEqualTo(88.0);
    }

    @Test
    void rejectsConflictingOrOutOfRangePressureFields() throws Exception {
        var conflicting = TelemetryPayloadNormalizer.normalize(objectMapper.readTree("""
                {
                  "device_id":"M01",
                  "session_id":"S1",
                  "depth_mm":50,
                  "pressure_balance_score_pct":90,
                  "pressure_balance_pct":80
                }
                """));
        var below = TelemetryPayloadNormalizer.normalize(objectMapper.readTree("""
                {"device_id":"M01","session_id":"S1","depth_mm":50,"pressure_balance_score_pct":-0.01}
                """));
        var above = TelemetryPayloadNormalizer.normalize(objectMapper.readTree("""
                {"device_id":"M01","session_id":"S1","depth_mm":50,"pressure_balance_score_pct":100.01}
                """));

        assertThat(conflicting.ok()).isFalse();
        assertThat(conflicting.reason()).contains("conflicts");
        assertThat(below.ok()).isFalse();
        assertThat(above.ok()).isFalse();
    }

    @Test
    void rejectsContradictoryFlagsAndReportsBoundedConsistency() throws Exception {
        var contradiction = TelemetryPayloadNormalizer.normalize(objectMapper.readTree("""
                {
                  "device_id":"M01",
                  "session_id":"S1",
                  "depth_mm":50,
                  "depth_ok":false,
                  "flags":"DEPTH_OK"
                }
                """));
        var validLegacyFlags = TelemetryPayloadNormalizer.normalize(objectMapper.readTree("""
                {
                  "device_id":"M01",
                  "session_id":"S1",
                  "depth_mm":50,
                  "depth_ok":true,
                  "flags":"DEPTH_OK"
                }
                """));

        assertThat(contradiction.ok()).isFalse();
        assertThat(contradiction.consistency())
                .isEqualTo(TelemetryPayloadNormalizer.MetricConsistency.INVALID_CONTRADICTORY_METRICS);
        assertThat(validLegacyFlags.ok()).isTrue();
        assertThat(validLegacyFlags.consistency())
                .isEqualTo(TelemetryPayloadNormalizer.MetricConsistency.VALID_WITH_LEGACY_FLAGS);
    }
}
