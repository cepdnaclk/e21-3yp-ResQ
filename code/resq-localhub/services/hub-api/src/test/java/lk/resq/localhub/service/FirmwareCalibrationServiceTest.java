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

class FirmwareCalibrationServiceTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void startCalibrationPublishesCommandAndReturnsRequestId() {
        Fixture fixture = newFixture();

        var response = fixture.service.startCalibration("M01", new FirmwareCalibrationStartRequest(
                13500,
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
        assertThat(fixture.publisher.lastPayload).contains("\"hall_delta\":13500");
        assertThat(fixture.publisher.lastPayload).contains("\"profile_id\":\"adult-basic\"");
    }

    @Test
    void startCalibrationFallsBackToDefaultProfileWhenValuesAreMissing() {
        Fixture fixture = newFixture();

        var response = fixture.service.startCalibration("M01", new FirmwareCalibrationStartRequest(null, null, null, null, null));

        assertThat(response.deviceId()).isEqualTo("M01");
        assertThat(fixture.publisher.lastPayload).contains("\"hall_delta\":13500");
        assertThat(fixture.publisher.lastPayload).contains("\"ref_pressure\":20100");
        assertThat(fixture.publisher.lastPayload).contains("\"profile_id\":\"adult-basic\"");
    }

    @Test
    void startCalibrationUsesRequestedProfileWhenOnlyProfileIdIsProvided() {
        Fixture fixture = newFixture();
        var created = fixture.profileService.createProfile(new CalibrationProfileRequest(
                "Adult Training",
                14000,
                20500,
                15250,
                15250,
                "Custom training profile",
                true,
                false
        ));

        fixture.service.startCalibration("M01", new FirmwareCalibrationStartRequest(null, null, null, null, created.profileId()));

        assertThat(fixture.publisher.lastPayload).contains("\"hall_delta\":14000");
        assertThat(fixture.publisher.lastPayload).contains("\"ref_pressure\":20500");
        assertThat(fixture.publisher.lastPayload).contains(created.profileId());
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
    void readinessIsTrueForReadyFirmwareOrPassingCalibration() throws Exception {
        Fixture fixture = newFixture();
        fixture.repository.saveCalibrationResult(calibration("M01", "PASS", "PAIRED_IDLE"));

        FirmwareReadinessResponse passReadiness = fixture.service.getLatestReadiness("M01");
        assertThat(passReadiness.readyForSession()).isTrue();
        assertThat(passReadiness.calibrated()).isTrue();

        fixture.registry.updateFromStatus("M02", objectMapper.readTree("""
                {
                  "deviceId": "M02",
                  "state": "READY_FOR_SESSION",
                  "calibrated": true
                }
                """));

        FirmwareReadinessResponse readyState = fixture.service.getLatestReadiness("M02");
        assertThat(readyState.readyForSession()).isTrue();
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
        calibratingFixture.registry.updateFromStatus("M01", objectMapper.readTree("""
                {"deviceId":"M01","state":"CALIBRATING"}
                """));
        assertThat(calibratingFixture.service.getLatestReadiness("M01").readyForSession()).isFalse();

        Fixture errorFixture = newFixture();
        errorFixture.registry.updateFromStatus("M01", objectMapper.readTree("""
                {"deviceId":"M01","state":"ERROR"}
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
        FirmwareCalibrationService service = new FirmwareCalibrationService(publisher, repository, profileService, registry);
        return new Fixture(service, repository, publisher, registry, profileService);
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
            CalibrationProfileService profileService
    ) {
    }
}
