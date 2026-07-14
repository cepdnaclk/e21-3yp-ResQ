package lk.resq.localhub.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.model.firmware.FirmwareCalibrationCommandResponse;
import lk.resq.localhub.model.firmware.FirmwareCalibrationStartRequest;
import lk.resq.localhub.model.firmware.FirmwareCommandTypeId;
import lk.resq.localhub.model.firmware.FirmwareTopics;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.CalibrationProfileRepository;
import lk.resq.localhub.service.CalibrationProfileService;
import lk.resq.localhub.service.CalibrationProfileFingerprintService;
import lk.resq.localhub.service.FirmwareCalibrationService;
import lk.resq.localhub.service.FirmwarePersistenceRepository;
import lk.resq.localhub.service.LocalAuthRepository;
import lk.resq.localhub.service.ManikinRegistryService;
import lk.resq.localhub.service.MqttCommandPublisherService;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

import java.nio.file.Path;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class FirmwareCalibrationControllerTest {

    @Test
    void startCalibrationEndpointPublishesCommandAndReturnsRequestId() {
        Fixture fixture = newFixture();

        ResponseEntity<?> response = fixture.controller.startCalibration(
                null,
                "M01",
                new FirmwareCalibrationStartRequest(620, 20100, 15000, 15000, null)
        );

        assertThat(response.getStatusCode()).isEqualTo(org.springframework.http.HttpStatus.ACCEPTED);
        assertThat(response.getBody()).isInstanceOf(FirmwareCalibrationCommandResponse.class);
        FirmwareCalibrationCommandResponse body = (FirmwareCalibrationCommandResponse) response.getBody();
        assertThat(body.requestId()).startsWith("req-200-");
        assertThat(body.topic()).isEqualTo(FirmwareTopics.calibrationStartCommandTopic("M01"));
        assertThat(fixture.publisher.lastCommandTypeId).isEqualTo(FirmwareCommandTypeId.CALIBRATION_START);
    }

    @Test
    void cancelCalibrationEndpointPublishesCommandAndReturnsRequestId() {
        Fixture fixture = newFixture();

        ResponseEntity<?> response = fixture.controller.cancelCalibration(null, "M01");

        assertThat(response.getStatusCode()).isEqualTo(org.springframework.http.HttpStatus.ACCEPTED);
        assertThat(response.getBody()).isInstanceOf(FirmwareCalibrationCommandResponse.class);
        FirmwareCalibrationCommandResponse body = (FirmwareCalibrationCommandResponse) response.getBody();
        assertThat(body.requestId()).startsWith("req-201-");
        assertThat(body.topic()).isEqualTo(FirmwareTopics.calibrationCancelCommandTopic("M01"));
        assertThat(fixture.publisher.lastCommandTypeId).isEqualTo(FirmwareCommandTypeId.CALIBRATION_CANCEL);
    }

    private static Fixture newFixture() {
        ObjectMapper objectMapper = new ObjectMapper();
        FirmwarePersistenceRepository repository = new FirmwarePersistenceRepository(
                Path.of("target", "firmware-calibration-controller-test-" + UUID.randomUUID() + ".sqlite").toString()
        );
        repository.initialize();
        CalibrationProfileRepository profileRepository = new CalibrationProfileRepository(
            Path.of("target", "firmware-calibration-controller-test-profile-" + UUID.randomUUID() + ".sqlite").toString()
        );
        profileRepository.initialize();
        CalibrationProfileFingerprintService fingerprintService = new CalibrationProfileFingerprintService();
        CalibrationProfileService profileService = new CalibrationProfileService(profileRepository, fingerprintService);
        CapturingPublisher publisher = new CapturingPublisher(objectMapper, repository);
        ManikinRegistryService registryService = new ManikinRegistryService(12);
        com.fasterxml.jackson.databind.node.ObjectNode livePayload = objectMapper.createObjectNode();
        livePayload.put("state", "paired_idle");
        registryService.updateFromStatus("M01", livePayload);
        FirmwareCalibrationService service = new FirmwareCalibrationService(
                publisher,
                repository,
                profileService,
                registryService,
                fingerprintService
        );
        FirmwareCalibrationController controller = new FirmwareCalibrationController(service, new AllowingAuthService(objectMapper));
        return new Fixture(controller, publisher);
    }

    private static final class CapturingPublisher extends MqttCommandPublisherService {
        private FirmwareCommandTypeId lastCommandTypeId;

        private CapturingPublisher(ObjectMapper objectMapper, FirmwarePersistenceRepository repository) {
            super(objectMapper, repository, "tcp://127.0.0.1:1", "test-publisher");
        }

        @Override
        protected void ensureConnected() {
        }

        @Override
        protected void publishToBroker(String topic, String jsonPayload) {
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

    private static final class AllowingAuthService extends AuthService {
        private AllowingAuthService(ObjectMapper objectMapper) {
            super(
                    new LocalAuthRepository(Path.of("target", "firmware-calibration-auth-test-" + UUID.randomUUID() + ".sqlite").toString()),
                    objectMapper,
                    8
            );
        }

        @Override
        public AuthUser requireRole(HttpServletRequest request, UserRole... allowedRoles) {
            return new AuthUser("instructor", "instructor", "Instructor", UserRole.INSTRUCTOR, null);
        }

        @Override
        public void audit(String actorUserId, String action, String targetType, String targetId, Map<String, Object> metadata) {
        }
    }

    private record Fixture(FirmwareCalibrationController controller, CapturingPublisher publisher) {
    }
}
