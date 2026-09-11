package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.localhub.model.firmware.CalibrationMqttEvent;
import lk.resq.localhub.model.firmware.CalibrationState;
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

    @Test
    void heartbeatRefreshesLastSeenWithoutErasingCalibrationStartFailure() throws Exception {
        DeviceRuntimeStateService service = new DeviceRuntimeStateService();

        service.applyCalibrationEvent("M01", calibrationEvent(4000, null, "NACK", "PAIRED_IDLE", 100L));
        DeviceRuntimeState state = service.applyHeartbeat("M01", objectMapper.readTree("""
                {"state":"PAIRED_IDLE","calibrated":false,"wifi_connected":true,"mqtt_connected":true,"backend_registered":true,"uptime_ms":5000,"ts_ms":101}
                """));

        assertThat(state.firmwareState()).isEqualTo("PAIRED_IDLE");
        assertThat(state.calibrationState()).isEqualTo(CalibrationState.FAILED.name());
        assertThat(state.lastSeenEpochMs()).isGreaterThan(0);
        assertThat(state.readyForSession()).isFalse();
    }

    @Test
    void calibrationPassCarriesCompleteProfileIdentityIntoReadiness() {
        DeviceRuntimeStateService service = new DeviceRuntimeStateService();
        String profileHash = "4da18fea2e079ce05c14f50a7dc687db762db3f6f0b8c93fc7c6b345e5cdab31";

        DeviceRuntimeState state = service.applyCalibrationEvent(
                "M01",
                new CalibrationMqttEvent(
                        "M01",
                        4002,
                        "req-phase6",
                        "ACK",
                        11,
                        "PASS",
                        "00000",
                        0,
                        "READY_FOR_SESSION",
                        100L,
                        Instant.now(),
                        "adult-basic"
                )
                        .withCalibrationIdentity(1, 3, "VALID", false, 7, profileHash)
                        .withOrdering("0123456789abcdef", 42L)
        );

        assertThat(state.readyForSession()).isTrue();
        assertThat(state.calibrationSchemaVersion()).isEqualTo(1);
        assertThat(state.calibrationGeneration()).isEqualTo(3);
        assertThat(state.calibrationStorageStatus()).isEqualTo("VALID");
        assertThat(state.recalibrationRequired()).isFalse();
        assertThat(state.profileVersion()).isEqualTo(7);
        assertThat(state.profileHash()).isEqualTo(profileHash);
        assertThat(state.bootId()).isEqualTo("0123456789abcdef");
        assertThat(state.stateSeq()).isEqualTo(42L);
    }

    @Test
    void failedRecalibrationPreservesPreviousTrustedProfile() {
        DeviceRuntimeStateService service = new DeviceRuntimeStateService();
        String oldHash = "4da18fea2e079ce05c14f50a7dc687db762db3f6f0b8c93fc7c6b345e5cdab31";
        String candidateHash = "b82453dd6c8100d280a5b711dceca20b8df17fe45ec7dfc6fbfd0d2ad257068f";

        service.applyCalibrationEvent(
                "M01",
                calibrationResultEvent("old-profile", "PASS", "ACK", "READY_FOR_SESSION", 100L)
                        .withCalibrationIdentity(1, 3, "VALID", false, 7, oldHash)
                        .withOrdering("0123456789abcdef", 40L)
        );
        DeviceRuntimeState failed = service.applyCalibrationEvent(
                "M01",
                calibrationResultEvent("candidate-profile", "FAIL", "NACK", "CALIBRATION_FAIL", 200L)
                        .withCalibrationIdentity(1, 4, "INVALID", true, 8, candidateHash)
                        .withOrdering("0123456789abcdef", 41L)
        );

        assertThat(failed.calibrationState()).isEqualTo("FAILED");
        assertThat(failed.firmwareState()).isEqualTo("CALIBRATION_FAIL");
        assertThat(failed.readyForSession()).isFalse();
        assertThat(failed.calibrated()).isTrue();
        assertThat(failed.calibrationProfileId()).isEqualTo("old-profile");
        assertThat(failed.calibrationStorageStatus()).isEqualTo("VALID");
        assertThat(failed.recalibrationRequired()).isFalse();
        assertThat(failed.profileVersion()).isEqualTo(7);
        assertThat(failed.profileHash()).isEqualTo(oldHash);
        assertThat(failed.calibrationGeneration()).isEqualTo(3);
    }

    @Test
    void successfulRecalibrationReplacesTrustedProfile() {
        DeviceRuntimeStateService service = new DeviceRuntimeStateService();
        String oldHash = "4da18fea2e079ce05c14f50a7dc687db762db3f6f0b8c93fc7c6b345e5cdab31";
        String newHash = "b82453dd6c8100d280a5b711dceca20b8df17fe45ec7dfc6fbfd0d2ad257068f";

        service.applyCalibrationEvent(
                "M01",
                calibrationResultEvent("old-profile", "PASS", "ACK", "READY_FOR_SESSION", 100L)
                        .withCalibrationIdentity(1, 3, "VALID", false, 7, oldHash)
                        .withOrdering("0123456789abcdef", 40L)
        );
        DeviceRuntimeState passed = service.applyCalibrationEvent(
                "M01",
                calibrationResultEvent("new-profile", "PASS", "ACK", "READY_FOR_SESSION", 200L)
                        .withCalibrationIdentity(1, 4, "VALID", false, 8, newHash)
                        .withOrdering("0123456789abcdef", 41L)
        );

        assertThat(passed.readyForSession()).isTrue();
        assertThat(passed.calibrated()).isTrue();
        assertThat(passed.calibrationProfileId()).isEqualTo("new-profile");
        assertThat(passed.profileVersion()).isEqualTo(8);
        assertThat(passed.profileHash()).isEqualTo(newHash);
        assertThat(passed.calibrationGeneration()).isEqualTo(4);
    }

    @Test
    void cancelledRecalibrationPreservesPreviousTrustedProfile() {
        DeviceRuntimeStateService service = new DeviceRuntimeStateService();
        String oldHash = "4da18fea2e079ce05c14f50a7dc687db762db3f6f0b8c93fc7c6b345e5cdab31";
        service.applyCalibrationEvent(
                "M01",
                calibrationResultEvent("old-profile", "PASS", "ACK", "READY_FOR_SESSION", 100L)
                        .withCalibrationIdentity(1, 3, "VALID", false, 7, oldHash)
                        .withOrdering("0123456789abcdef", 40L)
        );

        DeviceRuntimeState cancelled = service.applyCalibrationEvent(
                "M01",
                calibrationResultEvent("candidate-profile", "CANCELLED", "ACK", "PAIRED_IDLE", 200L)
                        .withOrdering("0123456789abcdef", 41L)
        );

        assertThat(cancelled.calibrationState()).isEqualTo("CANCELLED");
        assertThat(cancelled.calibrated()).isTrue();
        assertThat(cancelled.calibrationProfileId()).isEqualTo("old-profile");
        assertThat(cancelled.profileHash()).isEqualTo(oldHash);
    }

    @Test
    void interruptedSessionPreservesPreviousTrustedProfileWithoutRemainingReady() throws Exception {
        DeviceRuntimeStateService service = new DeviceRuntimeStateService();
        String oldHash = "4da18fea2e079ce05c14f50a7dc687db762db3f6f0b8c93fc7c6b345e5cdab31";
        service.applyCalibrationEvent(
                "M01",
                calibrationResultEvent("old-profile", "PASS", "ACK", "READY_FOR_SESSION", 100L)
                        .withCalibrationIdentity(1, 3, "VALID", false, 7, oldHash)
                        .withOrdering("0123456789abcdef", 40L)
        );

        DeviceRuntimeState interrupted = service.applyStatus("M01", objectMapper.readTree("""
                {
                  "state":"SESSION_INTERRUPTED",
                  "calibrated":false,
                  "session_active":false,
                  "ts_ms":200,
                  "boot_id":"0123456789abcdef",
                  "state_seq":41
                }
                """));

        assertThat(interrupted.firmwareState()).isEqualTo("SESSION_INTERRUPTED");
        assertThat(interrupted.calibrationState()).isEqualTo("INTERRUPTED");
        assertThat(interrupted.readyForSession()).isFalse();
        assertThat(interrupted.calibrated()).isTrue();
        assertThat(interrupted.calibrationProfileId()).isEqualTo("old-profile");
        assertThat(interrupted.calibrationStorageStatus()).isEqualTo("VALID");
        assertThat(interrupted.recalibrationRequired()).isFalse();
        assertThat(interrupted.profileVersion()).isEqualTo(7);
        assertThat(interrupted.profileHash()).isEqualTo(oldHash);
        assertThat(interrupted.calibrationGeneration()).isEqualTo(3);
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

    private static CalibrationMqttEvent calibrationResultEvent(
            String profileId,
            String result,
            String status,
            String state,
            Long tsMs
    ) {
        return new CalibrationMqttEvent(
                "M01",
                4002,
                "req-" + profileId,
                status,
                11,
                result,
                "00000",
                0,
                state,
                tsMs,
                Instant.now(),
                profileId
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
