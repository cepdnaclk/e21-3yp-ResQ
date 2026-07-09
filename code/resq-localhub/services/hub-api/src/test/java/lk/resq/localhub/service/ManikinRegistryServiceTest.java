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
        assertThat(device.latestDepthProgress()).isNull();
        assertThat(device.latestCompressionCount()).isEqualTo(18);
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

    @Test
    void sessionSnapshotDoesNotDriftWhenSameDeviceReportsAnotherSession() throws Exception {
        ManikinRegistryService registry = new ManikinRegistryService(12);
        JsonNode firstTelemetry = objectMapper.readTree("""
                {
                  "deviceId": "M01",
                  "sessionId": "S-OLD",
                  "seq": 1,
                  "depthMm": 48,
                  "rateCpm": 104
                }
                """);
        JsonNode secondTelemetry = objectMapper.readTree("""
                {
                  "deviceId": "M01",
                  "sessionId": "S-NEW",
                  "seq": 2,
                  "depthMm": 55,
                  "rateCpm": 118
                }
                """);

        registry.updateFromTelemetry("M01", firstTelemetry);
        registry.updateFromTelemetry("M01", secondTelemetry);

        SessionLiveView oldSession = registry.getSessionLiveView("S-OLD").orElseThrow();
        assertThat(oldSession.latestMetric()).isNotNull();
        assertThat(oldSession.latestMetric().sessionId()).isEqualTo("S-OLD");
        assertThat(oldSession.latestMetric().depthMm()).isEqualTo(48.0);
        assertThat(oldSession.seq()).isEqualTo(1L);

        SessionLiveView newSession = registry.getSessionLiveView("S-NEW").orElseThrow();
        assertThat(newSession.latestMetric()).isNotNull();
        assertThat(newSession.latestMetric().sessionId()).isEqualTo("S-NEW");
        assertThat(newSession.latestMetric().depthMm()).isEqualTo(55.0);
        assertThat(newSession.seq()).isEqualTo(2L);
    }

    @Test
    void statusHeartbeatAndEventsUpdateSessionLiveState() throws Exception {
        ManikinRegistryService registry = new ManikinRegistryService(12);
        JsonNode status = objectMapper.readTree("""
                {
                  "sessionId": "S-STATE",
                  "status": "ready",
                  "sessionActive": true,
                  "ip": "192.168.1.44"
                }
                """);
        JsonNode heartbeat = objectMapper.readTree("""
                {
                  "sessionId": "S-STATE",
                  "manikinId": "MK-01",
                  "rssi": -61,
                  "battery": 92
                }
                """);
        JsonNode event = objectMapper.readTree("""
                {
                  "sessionId": "S-STATE",
                  "eventType": "PAD_ADJUSTED"
                }
                """);

        registry.updateFromStatus("M01", status);
        registry.updateFromHeartbeat("M01", heartbeat);
        registry.updateFromEvent("M01", event);

        ManikinLiveSummary liveSummary = registry.getLiveSummary("M01").orElseThrow();
        assertThat(liveSummary.state()).isEqualTo("READY_FOR_SESSION");

        SessionLiveView session = registry.getSessionLiveView("S-STATE").orElseThrow();
        assertThat(session.deviceId()).isEqualTo("M01");
        assertThat(session.manikinId()).isEqualTo("MK-01");
        assertThat(session.state()).isEqualTo("READY_FOR_SESSION");
        assertThat(session.ip()).isEqualTo("192.168.1.44");
        assertThat(session.rssi()).isEqualTo(-61);
        assertThat(session.battery()).isEqualTo(92);
        assertThat(session.sessionActive()).isTrue();
        assertThat(session.lastEventType()).isEqualTo("PAD_ADJUSTED");
        assertThat(session.connectionState()).isEqualTo("BACKEND_SSE_FALLBACK");
    }

    @Test
    void statusAndHeartbeatAcceptSnakeCaseFieldsFromFirmwarePayloads() throws Exception {
        ManikinRegistryService registry = new ManikinRegistryService(12);

        registry.updateFromStatus(" M01 ", objectMapper.readTree("""
                {
                  "device_id": "M01",
                  "session_id": "S-SNAKE",
                  "state": "PAIRED_IDLE",
                  "session_active": true,
                  "ip_address": "192.168.1.55",
                  "firmware_version": "1.2.3"
                }
                """));

        registry.updateFromHeartbeat("M01", objectMapper.readTree("""
                {
                  "manikin_id": "MK-02",
                  "session_id": "S-SNAKE",
                  "state": "SESSION_ACTIVE",
                  "rssi": -61,
                  "battery": 88
                }
                """));

        ManikinLiveSummary liveSummary = registry.getLiveSummary("M01").orElseThrow();
        assertThat(liveSummary.online()).isTrue();
        assertThat(liveSummary.state()).isEqualTo("SESSION_ACTIVE");
        assertThat(liveSummary.manikinId()).isEqualTo("MK-02");
        assertThat(liveSummary.sessionId()).isEqualTo("S-SNAKE");
        assertThat(liveSummary.ip()).isEqualTo("192.168.1.55");
        assertThat(liveSummary.fw()).isEqualTo("1.2.3");
        assertThat(liveSummary.sessionActive()).isTrue();
        assertThat(liveSummary.rssi()).isEqualTo(-61);
        assertThat(liveSummary.battery()).isEqualTo(88);
    }

    @Test
    void calibrationAndErrorEventsUseFirmwareEventIds() throws Exception {
        ManikinRegistryService registry = new ManikinRegistryService(12);

        registry.updateFromCalibrationEvent("M01", objectMapper.readTree("""
                {
                  "sessionId": "S-CAL",
                  "event_id": 4001,
                  "result": "pass"
                }
                """));

        SessionLiveView calibrated = registry.getSessionLiveView("S-CAL").orElseThrow();
        assertThat(calibrated.state()).isEqualTo("READY_FOR_SESSION");
        assertThat(calibrated.lastEventType()).isEqualTo("4001");
        assertThat(calibrated.sessionActive()).isFalse();
        ManikinLiveSummary liveCalibrated = registry.getLiveSummary("M01").orElseThrow();
        assertThat(liveCalibrated.calibrated()).isTrue();
        assertThat(liveCalibrated.readyForSession()).isTrue();
        assertThat(liveCalibrated.calibrationResult()).isEqualTo("pass");

        registry.updateFromErrorEvent("M01", objectMapper.readTree("""
                {
                  "sessionId": "S-CAL",
                  "event_id": 5001
                }
                """));

        SessionLiveView errored = registry.getSessionLiveView("S-CAL").orElseThrow();
        assertThat(errored.state()).isEqualTo("ERROR");
        assertThat(errored.lastEventType()).isEqualTo("5001");
        assertThat(errored.sessionActive()).isFalse();
    }
}
