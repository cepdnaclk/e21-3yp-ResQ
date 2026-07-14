package lk.resq.localhub.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import lk.resq.localhub.model.ApiErrorResponse;
import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.model.firmware.CalibrationCommandResponse;
import lk.resq.localhub.model.firmware.CalibrationStartRequest;
import lk.resq.localhub.model.firmware.CalibrationState;
import lk.resq.localhub.model.firmware.DeviceReadinessState;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.CalibrationCommandService;
import lk.resq.localhub.service.DeviceReadinessService;
import lk.resq.localhub.service.CalibrationStreamService;
import lk.resq.localhub.service.FirmwarePersistenceRepository;
import lk.resq.localhub.service.CalibrationPersistenceRepository;
import lk.resq.localhub.service.CommandRequestIdGenerator;
import lk.resq.localhub.service.ForbiddenException;
import lk.resq.localhub.service.LocalAuthRepository;
import lk.resq.localhub.service.ManikinRegistryService;
import lk.resq.localhub.service.MqttCommandPublisherService;
import lk.resq.localhub.service.MqttCommandPublishException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.io.IOException;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class CalibrationControllerTest {

    private DummyCalibrationCommandService commandService;
    private DeviceReadinessService readinessService;
    private AllowingAuthService authService;
    private CalibrationController controller;

    @BeforeEach
    void setUp() {
        ObjectMapper objectMapper = new ObjectMapper();
        FirmwarePersistenceRepository repository = new FirmwarePersistenceRepository(
                Path.of("target", "calibration-controller-test-" + UUID.randomUUID() + ".sqlite").toString()
        );
        repository.initialize();
        
        DummyPublisher publisher = new DummyPublisher(objectMapper, repository);
        readinessService = new DeviceReadinessService();
        ManikinRegistryService registryService = new ManikinRegistryService(12);
        CommandRequestIdGenerator idGenerator = new CommandRequestIdGenerator();
        CalibrationStreamService streamService = new CalibrationStreamService(readinessService);

        CalibrationPersistenceRepository calRepo = new CalibrationPersistenceRepository(
                Path.of("target", "calibration-controller-test-cal-" + UUID.randomUUID() + ".sqlite").toString()
        );
        calRepo.initialize();

        commandService = new DummyCalibrationCommandService(publisher, readinessService, registryService, idGenerator, streamService);
        authService = new AllowingAuthService(objectMapper);
        controller = new CalibrationController(commandService, readinessService, authService, calRepo);
    }

    @Test
    void startCalibrationReturnsOkAndPublishedResponse() {
        CalibrationStartRequest request = new CalibrationStartRequest(13500, 20100, 15000, 15000, null, null, null);
        CalibrationCommandResponse mockResponse = new CalibrationCommandResponse(
                "M01",
                "req-200-0001",
                "calibration/start",
                "PUBLISHED",
                "published",
                Instant.now()
        );

        commandService.setMockStartResponse(mockResponse);

        ResponseEntity<?> response = controller.startCalibration(null, "M01", request);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
        assertThat(response.getBody()).isEqualTo(mockResponse);
    }

    @Test
    void startCalibrationReturnsBadRequestOnValidationFailure() {
        CalibrationStartRequest request = new CalibrationStartRequest(-5, 20100, 15000, 15000, null, null, null);
        commandService.setShouldThrowValidation(true);

        ResponseEntity<?> response = controller.startCalibration(null, "M01", request);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).isInstanceOf(ApiErrorResponse.class);
        ApiErrorResponse body = (ApiErrorResponse) response.getBody();
        assertThat(body.error()).contains("hall_delta must be positive");
    }

    @Test
    void startCalibrationReturnsServiceUnavailableOnMqttFailure() {
        CalibrationStartRequest request = new CalibrationStartRequest(13500, 20100, 15000, 15000, null, null, null);
        commandService.setShouldThrowMqttFailure(true);

        ResponseEntity<?> response = controller.startCalibration(null, "M01", request);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
    }

    @Test
    void startCalibrationReturnsForbiddenForInvalidRole() {
        authService.setAllowedRole(UserRole.TRAINEE);

        CalibrationStartRequest request = new CalibrationStartRequest(13500, 20100, 15000, 15000, null, null, null);

        ResponseEntity<?> response = controller.startCalibration(null, "M01", request);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    void cancelCalibrationReturnsOkAndPublishedResponse() {
        CalibrationCommandResponse mockResponse = new CalibrationCommandResponse(
                "M01",
                "req-201-0001",
                "calibration/cancel",
                "PUBLISHED",
                "published",
                Instant.now()
        );

        commandService.setMockCancelResponse(mockResponse);

        ResponseEntity<?> response = controller.cancelCalibration(null, "M01");
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
        assertThat(response.getBody()).isEqualTo(mockResponse);
    }

    @Test
    void readinessReturnsLatestState() {
        DeviceReadinessState state = readinessService.getReadiness("M01");
        ResponseEntity<?> response = controller.readiness(null, "M01");
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isEqualTo(state);
    }

    private static final class DummyCalibrationCommandService extends CalibrationCommandService {
        private CalibrationCommandResponse mockStartResponse;
        private CalibrationCommandResponse mockCancelResponse;
        private boolean shouldThrowValidation = false;
        private boolean shouldThrowMqttFailure = false;

        public DummyCalibrationCommandService(
                MqttCommandPublisherService publisher,
                DeviceReadinessService readinessService,
                ManikinRegistryService registryService,
                CommandRequestIdGenerator idGenerator,
                CalibrationStreamService streamService
        ) {
            super(publisher, readinessService, registryService, idGenerator, streamService, null, null);
        }

        public void setMockStartResponse(CalibrationCommandResponse response) {
            this.mockStartResponse = response;
        }

        public void setMockCancelResponse(CalibrationCommandResponse response) {
            this.mockCancelResponse = response;
        }

        public void setShouldThrowValidation(boolean value) {
            this.shouldThrowValidation = value;
        }

        public void setShouldThrowMqttFailure(boolean value) {
            this.shouldThrowMqttFailure = value;
        }

        @Override
        public CalibrationCommandResponse startCalibration(String deviceId, CalibrationStartRequest request) {
            if (shouldThrowValidation) {
                throw new IllegalArgumentException("hall_delta must be positive");
            }
            if (shouldThrowMqttFailure) {
                throw new MqttCommandPublishException("Publish failed", new RuntimeException());
            }
            return mockStartResponse;
        }

        @Override
        public CalibrationCommandResponse startCalibration(String deviceId, CalibrationStartRequest request, String createdByUsername) {
            return startCalibration(deviceId, request);
        }

        @Override
        public CalibrationCommandResponse cancelCalibration(String deviceId) {
            if (shouldThrowMqttFailure) {
                throw new MqttCommandPublishException("Publish failed", new RuntimeException());
            }
            return mockCancelResponse;
        }
    }

    private static final class DummyPublisher extends MqttCommandPublisherService {
        private DummyPublisher(ObjectMapper objectMapper, FirmwarePersistenceRepository repository) {
            super(objectMapper, repository, "tcp://127.0.0.1:1", "test-publisher");
        }

        @Override
        protected void ensureConnected() {
        }

        @Override
        protected void publishToBroker(String topic, String jsonPayload) {
        }
    }

    private static final class AllowingAuthService extends AuthService {
        private UserRole role = UserRole.INSTRUCTOR;

        private AllowingAuthService(ObjectMapper objectMapper) {
            super(
                    new LocalAuthRepository(Path.of("target", "calibration-controller-auth-test-" + UUID.randomUUID() + ".sqlite").toString()),
                    objectMapper,
                    8
            );
        }

        public void setAllowedRole(UserRole role) {
            this.role = role;
        }

        @Override
        public AuthUser requireRole(HttpServletRequest request, UserRole... allowedRoles) {
            boolean allowed = false;
            for (UserRole r : allowedRoles) {
                if (r == this.role) {
                    allowed = true;
                    break;
                }
            }
            if (!allowed) {
                throw new ForbiddenException("Access Denied");
            }
            return new AuthUser("user-1", "user-1", "Instructor/Admin", this.role, null);
        }

        @Override
        public void audit(String actorUserId, String action, String targetType, String targetId, Map<String, Object> metadata) {
        }
    }
}
