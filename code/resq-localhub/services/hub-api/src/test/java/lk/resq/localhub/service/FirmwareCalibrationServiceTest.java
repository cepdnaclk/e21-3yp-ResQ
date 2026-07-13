package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.localhub.model.firmware.CalibrationProfileRequest;
import lk.resq.localhub.model.firmware.FirmwareCalibrationResultRecord;
import lk.resq.localhub.model.firmware.FirmwareCalibrationStartRequest;
import lk.resq.localhub.model.firmware.FirmwareCommandTypeId;
import lk.resq.localhub.model.firmware.FirmwareReadinessResponse;
import lk.resq.localhub.model.firmware.FirmwareTopics;
import org.junit.jupiter.api.Test;

import java.nio.file.Path;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class FirmwareCalibrationServiceTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void startCalibrationPublishesCommandAndReturnsRequestId() {
        Fixture fixture = newFixture();

        var response = fixture.service.startCalibration("M01", new FirmwareCalibrationStartRequest(
                620,
                20100,
                15000,
                15000,
            "adult-basic"
        ));

        assertThat(response.deviceId()).isEqualTo("M01");
        assertThat(response.requestId()).isEqualTo("req-200-0001");
        assertThat(response.topic()).isEqualTo(FirmwareTopics.calibrationStartCommandTopic("M01"));
        assertThat(response.status()).isEqualTo("PUBLISHED");
        assertThat(fixture.publisher.lastCommandTypeId).isEqualTo(FirmwareCommandTypeId.CALIBRATION_START);
        assertThat(fixture.publisher.lastPayload).contains("\"hall_delta\":620");
        assertThat(fixture.publisher.lastPayload).contains("\"profile_id\":\"adult-basic\"");
    }

    @Test
    void startCalibrationFallsBackToDefaultProfileWhenValuesAreMissing() {
        Fixture fixture = newFixture();

        var response = fixture.service.startCalibration("M01", new FirmwareCalibrationStartRequest(null, null, null, null, null));

        assertThat(response.deviceId()).isEqualTo("M01");
        assertThat(fixture.publisher.lastPayload).contains("\"hall_delta\":620");
        assertThat(fixture.publisher.lastPayload).contains("\"ref_pressure\":1405000");
        assertThat(fixture.publisher.lastPayload).contains("\"bladder_1_pressure\":1500000");
        assertThat(fixture.publisher.lastPayload).contains("\"bladder_2_pressure\":1500000");
        assertThat(fixture.publisher.lastPayload).contains("\"profile_id\":\"adult-basic\"");
    }

    @Test
    void startCalibrationUsesRequestedProfileWhenOnlyProfileIdIsProvided() {
        Fixture fixture = newFixture();
        var created = fixture.profileService.createProfile(new CalibrationProfileRequest(
                "Adult Training",
                700,
                20500,
                15250,
                15250,
                "Custom training profile",
                true,
                false
        ));

        fixture.service.startCalibration("M01", new FirmwareCalibrationStartRequest(null, null, null, null, created.profileId()));

        assertThat(fixture.publisher.lastPayload).contains("\"hall_delta\":700");
        assertThat(fixture.publisher.lastPayload).contains("\"ref_pressure\":20500");
        assertThat(fixture.publisher.lastPayload).contains(created.profileId());
    }

    @Test
    void startCalibrationRejectsHallDeltaOutsideAdcRange() {
        Fixture fixture = newFixture();

        assertThatThrownBy(() -> fixture.service.startCalibration(
                "M01",
                new FirmwareCalibrationStartRequest(4096, null, null, null, null)
        )).isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("4095");
    }

    @Test
    void cancelCalibrationPublishesCommandAndReturnsRequestId() {
        Fixture fixture = newFixture();

        var response = fixture.service.cancelCalibration("M01");

        assertThat(response.deviceId()).isEqualTo("M01");
        assertThat(response.requestId()).isEqualTo("req-201-0001");
        assertThat(response.topic()).isEqualTo(FirmwareTopics.calibrationCancelCommandTopic("M01"));
        assertThat(response.status()).isEqualTo("PUBLISHED");
        assertThat(fixture.publisher.lastCommandTypeId).isEqualTo(FirmwareCommandTypeId.CALIBRATION_CANCEL);
    }

    @Test
    void readinessUsesRuntimeStateAndKeepsHistoricalResultSeparate() throws Exception {
        Fixture fixture = newFixture();
        fixture.repository.saveCalibrationResult(calibration("M01", "PASS", "PAIRED_IDLE"));

        FirmwareReadinessResponse historicalOnly = fixture.service.getLatestReadiness("M01");
        assertThat(historicalOnly.latestResult()).isEqualTo("PASS");
        assertThat(historicalOnly.readyForSession()).isFalse();
        assertThat(historicalOnly.calibrated()).isFalse();

        fixture.runtimeStateService.applyStatus("M01", objectMapper.readTree("""
                {
                  "deviceId": "M01",
                  "state": "READY_FOR_SESSION",
                  "calibrated": true,
                  "ts_ms": 200
                }
                """));

        FirmwareReadinessResponse passReadiness = fixture.service.getLatestReadiness("M01");
        assertThat(passReadiness.latestResult()).isEqualTo("PASS");
        assertThat(passReadiness.readyForSession()).isTrue();
        assertThat(passReadiness.calibrated()).isTrue();

        fixture.repository.saveCalibrationResult(calibration("M02", "FAIL", "CALIBRATION_FAIL"));
        fixture.runtimeStateService.applyStatus("M02", objectMapper.readTree("""
                {
                  "deviceId": "M02",
                  "state": "READY_FOR_SESSION",
                  "calibrated": false,
                  "ts_ms": 200
                }
                """));

        FirmwareReadinessResponse readyState = fixture.service.getLatestReadiness("M02");
        assertThat(readyState.readyForSession()).isFalse();
        assertThat(readyState.calibrated()).isFalse();
        assertThat(readyState.firmwareState()).isEqualTo("READY_FOR_SESSION");
    }

    @Test
    void readinessIsFalseForFailCancelledCalibratingAndError() throws Exception {
        Fixture failFixture = newFixture();
        failFixture.repository.saveCalibrationResult(calibration("M01", "FAIL", "CALIBRATION_FAIL"));
        assertThat(failFixture.service.getLatestReadiness("M01").readyForSession()).isFalse();

        Fixture cancelledFixture = newFixture();
        cancelledFixture.repository.saveCalibrationResult(calibration("M01", "CANCELLED", "PAIRED_IDLE"));
        assertThat(cancelledFixture.service.getLatestReadiness("M01").readyForSession()).isFalse();

        Fixture calibratingFixture = newFixture();
        calibratingFixture.runtimeStateService.applyStatus("M01", objectMapper.readTree("""
                {"deviceId":"M01","state":"CALIBRATING","ts_ms":200}
                """));
        assertThat(calibratingFixture.service.getLatestReadiness("M01").readyForSession()).isFalse();

        Fixture errorFixture = newFixture();
        errorFixture.runtimeStateService.applyStatus("M01", objectMapper.readTree("""
                {"deviceId":"M01","state":"ERROR","ts_ms":200}
                """));
        assertThat(errorFixture.service.getLatestReadiness("M01").readyForSession()).isFalse();
    }

    private Fixture newFixture() {
        FirmwarePersistenceRepository repository = new FirmwarePersistenceRepository(
                Path.of("target", "firmware-calibration-service-test-" + UUID.randomUUID() + ".sqlite").toString()
        );
        repository.initialize();
        CalibrationProfileRepository profileRepository = new CalibrationProfileRepository(
            Path.of("target", "firmware-calibration-service-test-" + UUID.randomUUID() + ".sqlite").toString()
        );
        profileRepository.initialize();
        CalibrationProfileService profileService = new CalibrationProfileService(profileRepository);
        CapturingPublisher publisher = new CapturingPublisher(objectMapper, repository);
        ManikinRegistryService registry = new ManikinRegistryService(12);
        registry.seedFromRegistration("M01", null);
        DeviceRuntimeStateService runtimeStateService = new DeviceRuntimeStateService();
        FirmwareCalibrationService service = new FirmwareCalibrationService(publisher, repository, profileService, registry, runtimeStateService);
        return new Fixture(service, repository, publisher, registry, profileService, runtimeStateService);
    }

    private FirmwareCalibrationResultRecord calibration(String deviceId, String result, String state) {
        return new FirmwareCalibrationResultRecord(
                0,
                deviceId,
                null,
                "req-400-0001",
                "req-400-0001",
                4002,
                result,
                "ACK",
                2,
                "00000",
                0,
                state,
                "PASS".equals(result),
                123456L,
                Instant.parse("2024-01-01T00:00:00Z"),
                "{}"
        );
    }

    private static final class CapturingPublisher extends MqttCommandPublisherService {
        private FirmwareCommandTypeId lastCommandTypeId;
        private String lastPayload;

        private CapturingPublisher(ObjectMapper objectMapper, FirmwarePersistenceRepository repository) {
            super(objectMapper, repository, "tcp://127.0.0.1:1", "test-publisher");
        }

        @Override
        protected void ensureConnected() {
        }

        @Override
        protected void publishToBroker(String topic, String jsonPayload) {
            lastPayload = jsonPayload;
        }

        @Override
        protected FirmwareCommandPublishResult publishFirmwareCommand(
                String topic,
                Map<String, Object> payload,
                String action,
                FirmwareCommandTypeId commandTypeId
        ) {
            lastCommandTypeId = commandTypeId;
            return super.publishFirmwareCommand(topic, payload, action, commandTypeId);
        }
    }

    private record Fixture(
            FirmwareCalibrationService service,
            FirmwarePersistenceRepository repository,
            CapturingPublisher publisher,
            ManikinRegistryService registry,
            CalibrationProfileService profileService,
            DeviceRuntimeStateService runtimeStateService
    ) {
    }
}
