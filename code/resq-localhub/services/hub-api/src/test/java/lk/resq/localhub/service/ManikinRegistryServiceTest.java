package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.localhub.model.ManikinLiveSummary;
import lk.resq.localhub.model.SessionLiveView;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ManikinRegistryServiceTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void telemetryUpdatesLatestMetricByDeviceAndSession() throws Exception {
        ManikinRegistryService registry = new ManikinRegistryService(12);
        JsonNode telemetry = objectMapper.readTree("""
                {
                  "deviceId": "M01",
                  "sessionId": "S-TEST-001",
                  "seq": 1,
                  "tsMs": 12345678,
                  "depthMm": 52,
                  "rateCpm": 110,
                  "recoilOk": true,
                  "pauseS": 0.2,
                  "compressionCount": 18,
                  "handPlacement": "CENTER",
                  "flags": ["DEPTH_OK", "RATE_OK", "RECOIL_OK"]
                }
                """);

        registry.updateFromTelemetry("M01", telemetry);

        ManikinLiveSummary device = registry.getLiveSummary("M01").orElseThrow();
        assertThat(device.latestMetric()).isNotNull();
        assertThat(device.latestMetric().sessionId()).isEqualTo("S-TEST-001");
        assertThat(device.latestMetric().depthMm()).isEqualTo(52.0);
        assertThat(device.seq()).isEqualTo(1L);
        assertThat(device.connectionState()).isEqualTo("BACKEND_SSE_FALLBACK");
        assertThat(device.stale()).isFalse();
        assertThat(device.offline()).isFalse();

        SessionLiveView session = registry.getSessionLiveView("S-TEST-001").orElseThrow();
        assertThat(session.deviceId()).isEqualTo("M01");
        assertThat(session.latestMetric()).isNotNull();
        assertThat(session.latestMetric().compressionCount()).isEqualTo(18);
        assertThat(session.latestMetric().handPlacement()).isEqualTo("CENTER");
    }
}
