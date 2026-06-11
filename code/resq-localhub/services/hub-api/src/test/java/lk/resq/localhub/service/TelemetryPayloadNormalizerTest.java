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
        assertThat(result.value().rateCpm()).isEqualTo(112.0);
        assertThat(result.value().recoilOk()).isTrue();
        assertThat(result.value().compressionCount()).isEqualTo(16);
        assertThat(result.value().handPlacement()).isEqualTo("CENTER");
        assertThat(result.value().sourceMode()).isEqualTo("calibration");
        assertThat(result.value().debugRaw()).isNotNull();
    }

    @Test
    void acceptsCanonicalFirmwareTelemetryWithoutPayloadDeviceIdWhenTopicDeviceIdExists() throws Exception {
        var payload = objectMapper.readTree("""
                {
                  "session_id": "S-FW-2",
                  "state": "SESSION_ACTIVE",
                  "depth_progress": 0.78,
                  "depth_ok": true,
                  "rate_cpm": 111,
                  "compression_count": 1,
                  "valid_compression_count": 0,
                  "recoil_ok_count": 0,
                  "incomplete_recoil_count": 0,
                  "pause_s": 0.2,
                  "hand_placement": "CENTER",
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
        assertThat(result.value().depthMm()).isNull();
        assertThat(result.value().depthProgress()).isEqualTo(0.78);
        assertThat(result.value().rateCpm()).isEqualTo(111.0);
        assertThat(result.value().recoilOk()).isTrue();
        assertThat(result.value().compressionCount()).isEqualTo(1);
        assertThat(result.value().handPlacement()).isEqualTo("CENTER");
        assertThat(result.value().flags()).isEqualTo("DEPTH_OK,RATE_OK,RECOIL_OK");
        assertThat(result.value().tsMs()).isEqualTo(100432L);
        assertThat(result.value().debugRaw()).isNotNull();
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
}
