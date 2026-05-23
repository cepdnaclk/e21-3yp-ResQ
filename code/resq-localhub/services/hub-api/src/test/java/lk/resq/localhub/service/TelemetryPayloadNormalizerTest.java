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
                  "depth_progress": 54.25,
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
        assertThat(result.warnings()).contains("used firmware depth_progress/current_delta as fallback depthMm");
        assertThat(result.value().depthMm()).isEqualTo(54.25);
        assertThat(result.value().rateCpm()).isEqualTo(112.0);
        assertThat(result.value().recoilOk()).isTrue();
        assertThat(result.value().compressionCount()).isEqualTo(16);
        assertThat(result.value().handPlacement()).isEqualTo("CENTER");
        assertThat(result.value().sourceMode()).isEqualTo("calibration");
        assertThat(result.value().debugRaw()).isNotNull();
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
        assertThat(result.value().flags()).isEqualTo("DEPTH_OK,RATE_OK,RECOIL_OK");
    }
}
