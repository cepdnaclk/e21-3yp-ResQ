package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

class SensorStreamServiceTest {

    private final SensorStreamService service = new SensorStreamService();
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void parsesAuthoritativeRawSensorStreamFields() throws Exception {
        var snapshot = service.parseSnapshot("M01", objectMapper.readTree("""
                {
                  "device_id":"M01",
                  "telemetry_mode":"SENSOR_STREAM",
                  "state":"PAIRED_IDLE",
                  "pressure_0_raw":1244088,
                  "pressure_0_raw_valid":true,
                  "pressure_1_raw":3279680,
                  "pressure_1_raw_valid":true,
                  "pressure_2_raw":-999999,
                  "pressure_2_raw_valid":false,
                  "hall_raw":2783,
                  "hall_raw_valid":true,
                  "pressure_0_kpa":0.0,
                  "pressure_0_kpa_valid":false,
                  "pressure_1_kpa":0.0,
                  "pressure_1_kpa_valid":false,
                  "pressure_2_kpa":0.0,
                  "pressure_2_kpa_valid":false,
                  "pressure_kpa_valid":false,
                  "hall_mm":0.0,
                  "hall_progress":0.0,
                  "hall_mm_valid":false,
                  "pressure_saturation_mask":4,
                  "interval_ms":200,
                  "ts_ms":1234
                }
                """), Instant.parse("2026-07-15T00:00:00Z"));

        assertThat(snapshot.pressure0Raw()).isEqualTo(1244088);
        assertThat(snapshot.pressure2RawValid()).isFalse();
        assertThat(snapshot.hallRaw()).isEqualTo(2783);
        assertThat(snapshot.pressure0KpaValid()).isFalse();
    }

    @Test
    void correlatesRepliesAndKeepsStartStopIdempotentPerDevice() {
        assertThat(service.beginStart("M01")).isTrue();
        service.commandPublished("M01", "start-1", "START");
        assertThat(service.beginStart("M01")).isFalse();

        assertThat(service.handleCommandReply("M01", 1000, "wrong", "ACK", null, "PAIRED_IDLE")).isFalse();
        assertThat(service.latestControl("M01").orElseThrow().streamState()).isEqualTo("STARTING");
        assertThat(service.handleCommandReply("M01", 1000, "start-1", "ACK", null, "PAIRED_IDLE")).isTrue();
        assertThat(service.latestControl("M01").orElseThrow().streamState()).isEqualTo("RUNNING");

        assertThat(service.beginStop("M01")).isTrue();
        service.commandPublished("M01", "stop-1", "STOP");
        assertThat(service.beginStop("M01")).isFalse();
        assertThat(service.handleCommandReply("M01", 1000, "stop-1", "ACK", null, "PAIRED_IDLE")).isTrue();
        assertThat(service.latestControl("M01").orElseThrow().streamState()).isEqualTo("IDLE");
        assertThat(service.latestControl("M01").orElseThrow().requestId()).isNotEqualTo("start-1");
    }

    @Test
    void reportsCalibrationOwnershipWithoutWeakeningTheSensorGate() {
        service.beginStart("M01");
        service.commandPublished("M01", "start-1", "START");
        service.handleCommandReply("M01", 1000, "start-1", "ACK", null, "PAIRED_IDLE");

        service.markCalibrationOwned("M01", "CALIBRATING");

        assertThat(service.latestControl("M01").orElseThrow()).satisfies(update -> {
            assertThat(update.streamState()).isEqualTo("CALIBRATION_OWNED");
            assertThat(update.reasonId()).isEqualTo("manual_stream_stopped_for_calibration");
        });
    }
}
