package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.localhub.model.LiveMetricPayload;
import lk.resq.localhub.model.ManikinLiveSummary;
import lk.resq.localhub.model.firmware.CalibrationCommandResponse;
import lk.resq.localhub.model.firmware.CalibrationStartRequest;
import lk.resq.localhub.model.firmware.CalibrationState;
import lk.resq.localhub.model.firmware.DeviceReadinessState;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Collections;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CalibrationCommandServiceTest {

    private CapturingPublisher publisher;
    private DeviceReadinessService readinessService;
    private ManikinRegistryService registryService;
    private FirmwareRequestIdGenerator idGenerator;
    private CalibrationCommandService service;

    @BeforeEach
    void setUp() {
        ObjectMapper objectMapper = new ObjectMapper();
        FirmwarePersistenceRepository repository = new FirmwarePersistenceRepository(
                Path.of("target", "calibration-service-test-" + UUID.randomUUID() + ".sqlite").toString()
        );
        repository.initialize();

        publisher = new CapturingPublisher(objectMapper, repository);
        readinessService = new DeviceReadinessService();
        registryService = new ManikinRegistryService(12);
        idGenerator = new FirmwareRequestIdGenerator();
        service = new CalibrationCommandService(publisher, readinessService, registryService, idGenerator);
    }

    @Test
    void startCalibrationThrowsIfDeviceNotRegistered() {
        // Device M01 is not registered in registryService
        CalibrationStartRequest request = new CalibrationStartRequest(13500, 20100, 15000, 15000, null, null, null);

        assertThatThrownBy(() -> service.startCalibration("M01", request))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("not registered");

        assertThat(publisher.lastDeviceId).isNull();
    }

    @Test
    void startCalibrationThrowsIfRequiredFieldMissing() {
        // Register device
        registerDevice("M01");

        // Missing hall_delta
        CalibrationStartRequest request1 = new CalibrationStartRequest(null, 20100, 15000, 15000, null, null, null);
        assertThatThrownBy(() -> service.startCalibration("M01", request1))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("hall_delta is required");

        // Negative ref_pressure
        CalibrationStartRequest request2 = new CalibrationStartRequest(13500, -5, 15000, 15000, null, null, null);
        assertThatThrownBy(() -> service.startCalibration("M01", request2))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("ref_pressure must be positive");
    }

    @Test
    void cancelCalibrationThrowsIfDeviceNotRegistered() {
        assertThatThrownBy(() -> service.cancelCalibration("M01"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("not registered");

        assertThat(publisher.lastDeviceId).isNull();
    }

    @Test
    void successfulStartPublishTransitionsReadinessImmediatelyToStarting() {
        registerDevice("M01");

        CalibrationStartRequest request = new CalibrationStartRequest(13500, 20100, 15000, 15000, "adult-basic", 20, 3000);

        CalibrationCommandResponse response = service.startCalibration("M01", request);

        assertThat(response.status()).isEqualTo("PUBLISHED");
        assertThat(response.requestId()).isEqualTo("req-200-0001");

        // Verify publisher captured it
        assertThat(publisher.lastDeviceId).isEqualTo("M01");
        assertThat(publisher.lastRequestId).isEqualTo("req-200-0001");
        assertThat(publisher.lastStartRequest).isEqualTo(request);

        // Verify readiness state immediately updated to STARTING, progressId=1, readyForSession=false
        DeviceReadinessState state = readinessService.getReadiness("M01");
        assertThat(state.calibrationState()).isEqualTo(CalibrationState.STARTING);
        assertThat(state.currentProgressId()).isEqualTo(1);
        assertThat(state.readyForSession()).isFalse();
        assertThat(state.lastReplyId()).isEqualTo("req-200-0001");
    }

    @Test
    void mqttPublishFailureDoesNotTransitionReadinessState() {
        registerDevice("M01");

        CalibrationStartRequest request = new CalibrationStartRequest(13500, 20100, 15000, 15000, null, null, null);
        publisher.shouldThrowOnPublish = true;

        assertThatThrownBy(() -> service.startCalibration("M01", request))
                .isInstanceOf(MqttCommandPublishException.class);

        // State remains UNKNOWN
        DeviceReadinessState state = readinessService.getReadiness("M01");
        assertThat(state.calibrationState()).isEqualTo(CalibrationState.UNKNOWN);
    }

    @Test
    void cancelCalibrationPublishesCommandSuccessfully() {
        registerDevice("M01");

        CalibrationCommandResponse response = service.cancelCalibration("M01");

        assertThat(response.status()).isEqualTo("PUBLISHED");
        assertThat(response.requestId()).isEqualTo("req-201-0001");

        assertThat(publisher.lastDeviceId).isEqualTo("M01");
        assertThat(publisher.lastRequestId).isEqualTo("req-201-0001");
    }

    private void registerDevice(String deviceId) {
        // Send a status payload to register device in manikinRegistryService
        com.fasterxml.jackson.databind.node.ObjectNode payload = new ObjectMapper().createObjectNode();
        payload.put("state", "paired_idle");
        registryService.updateFromStatus(deviceId, payload);
    }

    private static final class CapturingPublisher extends MqttCommandPublisherService {
        private String lastDeviceId;
        private String lastRequestId;
        private CalibrationStartRequest lastStartRequest;
        private boolean shouldThrowOnPublish = false;

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
        public FirmwareCommandPublishResult publishCalibrationStart(
                String deviceId,
                String requestId,
                CalibrationStartRequest request
        ) {
            if (shouldThrowOnPublish) {
                throw new MqttCommandPublishException("Publish failed", new RuntimeException());
            }
            this.lastDeviceId = deviceId;
            this.lastRequestId = requestId;
            this.lastStartRequest = request;
            return new FirmwareCommandPublishResult("topic", requestId, Map.of());
        }

        @Override
        public FirmwareCommandPublishResult publishCalibrationCancel(
                String deviceId,
                String requestId
        ) {
            if (shouldThrowOnPublish) {
                throw new MqttCommandPublishException("Publish failed", new RuntimeException());
            }
            this.lastDeviceId = deviceId;
            this.lastRequestId = requestId;
            return new FirmwareCommandPublishResult("topic", requestId, Map.of());
        }
    }
}
