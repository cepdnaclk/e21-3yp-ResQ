package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.localhub.model.firmware.CalibrationMqttEvent;
import lk.resq.localhub.model.firmware.DeviceRuntimeState;
import lk.resq.localhub.model.firmware.FirmwareCalibrationResultRecord;
import org.junit.jupiter.api.Test;

import java.nio.file.Path;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class DeviceRuntimeStateServiceTest {

    private final ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();

    @Test
    void passThenPairedIdleKeepsHistoricalResultButClearsCurrentReadiness() throws Exception {
        DeviceRuntimeStateService service = new DeviceRuntimeStateService();

        service.applyCalibrationEvent("M01", calibrationEvent(4002, "PASS", "ACK", "READY_FOR_SESSION", 100L));
        DeviceRuntimeState state = service.applyStatus("M01", objectMapper.readTree("""
                {"state":"PAIRED_IDLE","calibrated":false,"session_active":false,"ts_ms":200}
                """));

        assertThat(state.lastCalibrationResult()).isEqualTo("PASS");
        assertThat(state.firmwareState()).isEqualTo("PAIRED_IDLE");
        assertThat(state.calibrated()).isFalse();
        assertThat(state.readyForSession()).isFalse();
    }

    @Test
    void retainedReadyStatusRestoresReadiness() throws Exception {
        DeviceRuntimeStateService service = new DeviceRuntimeStateService();

        DeviceRuntimeState state = service.applyStatus("M01", objectMapper.readTree("""
                {"state":"READY_FOR_SESSION","calibrated":true,"session_active":false,"ts_ms":200}
                """));

        assertThat(state.readyForSession()).isTrue();
        assertThat(service.isReadyForSession("M01")).isTrue();
    }

    @Test
    void persistedHistoricalPassDoesNotOverrideRetainedPairedIdleAfterRestart() throws Exception {
        FirmwarePersistenceRepository repository = newRepository();
        repository.saveCalibrationResult(calibration("M01", "PASS", "READY_FOR_SESSION"));

        DeviceRuntimeStateService service = new DeviceRuntimeStateService();
        DeviceRuntimeState state = service.applyStatus("M01", objectMapper.readTree("""
                {"state":"PAIRED_IDLE","calibrated":false,"session_active":false,"ts_ms":200}
                """));

        assertThat(repository.findLatestCalibrationResult("M01").orElseThrow().result()).isEqualTo("PASS");
        assertThat(state.readyForSession()).isFalse();
        assertThat(state.firmwareState()).isEqualTo("PAIRED_IDLE");
    }

    @Test
    void retainedReadyRestoresCurrentReadinessAfterRestartWithHistoricalPass() throws Exception {
        FirmwarePersistenceRepository repository = newRepository();
        repository.saveCalibrationResult(calibration("M01", "PASS", "READY_FOR_SESSION"));

        DeviceRuntimeStateService service = new DeviceRuntimeStateService();
        DeviceRuntimeState state = service.applyStatus("M01", objectMapper.readTree("""
                {"state":"READY_FOR_SESSION","calibrated":true,"session_active":false,"ts_ms":200}
                """));

        assertThat(repository.findLatestCalibrationResult("M01").orElseThrow().result()).isEqualTo("PASS");
        assertThat(state.readyForSession()).isTrue();
    }

    @Test
    void calibrationFailIsNeverReady() {
        DeviceRuntimeStateService service = new DeviceRuntimeStateService();

        DeviceRuntimeState state = service.applyCalibrationEvent("M01", calibrationEvent(4002, "FAIL", "NACK", "CALIBRATION_FAIL", 100L));

        assertThat(state.firmwareState()).isEqualTo("CALIBRATION_FAIL");
        assertThat(state.calibrated()).isFalse();
        assertThat(state.readyForSession()).isFalse();
    }

    @Test
    void staleCalibrationEventCannotReverseNewerStatus() throws Exception {
        DeviceRuntimeStateService service = new DeviceRuntimeStateService();

        service.applyStatus("M01", objectMapper.readTree("""
                {"state":"READY_FOR_SESSION","calibrated":true,"session_active":false,"ts_ms":200}
                """));
        DeviceRuntimeState state = service.applyCalibrationEvent("M01", calibrationEvent(4002, "FAIL", "NACK", "CALIBRATION_FAIL", 100L));

        assertThat(state.firmwareState()).isEqualTo("READY_FOR_SESSION");
        assertThat(state.readyForSession()).isTrue();
    }

    @Test
    void laterStatusOverridesCalibrationPass() throws Exception {
        DeviceRuntimeStateService service = new DeviceRuntimeStateService();

        service.applyCalibrationEvent("M01", calibrationEvent(4002, "PASS", "ACK", "READY_FOR_SESSION", 100L));
        DeviceRuntimeState state = service.applyStatus("M01", objectMapper.readTree("""
                {"state":"PAIRED_IDLE","calibrated":false,"session_active":false,"ts_ms":200}
                """));

        assertThat(state.readyForSession()).isFalse();
        assertThat(state.firmwareState()).isEqualTo("PAIRED_IDLE");
    }

    @Test
    void devicesRemainIsolated() throws Exception {
        DeviceRuntimeStateService service = new DeviceRuntimeStateService();

        service.applyStatus("M01", objectMapper.readTree("""
                {"state":"READY_FOR_SESSION","calibrated":true,"session_active":false,"ts_ms":200}
                """));
        service.applyStatus("M02", objectMapper.readTree("""
                {"state":"PAIRED_IDLE","calibrated":false,"session_active":false,"ts_ms":200}
                """));

        assertThat(service.isReadyForSession("M01")).isTrue();
        assertThat(service.isReadyForSession("M02")).isFalse();
    }

    @Test
    void heartbeatOmittingStateAndCalibratedDoesNotEraseStatusReadiness() throws Exception {
        DeviceRuntimeStateService service = new DeviceRuntimeStateService();

        service.applyStatus("M01", objectMapper.readTree("""
                {"state":"READY_FOR_SESSION","calibrated":true,"session_active":false,"ts_ms":200}
                """));
        DeviceRuntimeState state = service.applyHeartbeat("M01", objectMapper.readTree("""
                {"wifi_connected":true,"mqtt_connected":true,"backend_registered":true,"uptime_ms":1000,"ts_ms":201}
                """));

        assertThat(state.firmwareState()).isEqualTo("READY_FOR_SESSION");
        assertThat(state.calibrated()).isTrue();
        assertThat(state.readyForSession()).isTrue();
    }

    static CalibrationMqttEvent calibrationEvent(Integer eventId, String result, String status, String state, Long tsMs) {
        return new CalibrationMqttEvent(
                "M01",
                eventId,
                "req-phase1",
                status,
                eventId == 4002 ? 11 : null,
                result,
                "00000",
                0,
                state,
                tsMs,
                Instant.now()
        );
    }

    private static FirmwarePersistenceRepository newRepository() {
        FirmwarePersistenceRepository repository = new FirmwarePersistenceRepository(
                Path.of("target", "runtime-state-service-test-" + UUID.randomUUID() + ".sqlite").toString()
        );
        repository.initialize();
        return repository;
    }

    private static FirmwareCalibrationResultRecord calibration(String deviceId, String result, String state) {
        return new FirmwareCalibrationResultRecord(
                0,
                deviceId,
                "adult-basic",
                "req-200-phase1",
                "req-200-phase1",
                4002,
                result,
                "ACK",
                11,
                "00000",
                0,
                state,
                "PASS".equals(result),
                100L,
                Instant.now(),
                "{}"
        );
    }
}
