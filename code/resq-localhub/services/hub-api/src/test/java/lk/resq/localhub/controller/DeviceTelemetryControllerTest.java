package lk.resq.localhub.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.model.firmware.FirmwareCommandTypeId;
import lk.resq.localhub.model.firmware.FirmwareTopics;
import lk.resq.localhub.model.firmware.SensorStreamSnapshot;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.FirmwarePersistenceRepository;
import lk.resq.localhub.service.LocalAuthRepository;
import lk.resq.localhub.service.MqttCommandPublisherService;
import lk.resq.localhub.service.SensorStreamService;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.nio.file.Path;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class DeviceTelemetryControllerTest {

    @Test
    void startTelemetryRejectsMissingAndOutOfRangeInterval() {
        Fixture fixture = newFixture();

        assertThat(fixture.controller.startTelemetry(null, "M01", null).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(fixture.controller.startTelemetry(null, "M01", Map.of("interval_ms", 99)).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(fixture.controller.startTelemetry(null, "M01", Map.of("interval_ms", 1001)).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(fixture.controller.startTelemetry(null, "M01", Map.of("interval_ms", -1)).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    void startTelemetryPublishesCanonicalStartCommand() {
        Fixture fixture = newFixture();

        ResponseEntity<?> response = fixture.controller.startTelemetry(null, "M01", Map.of("interval_ms", 200));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
        assertThat(fixture.publisher.lastTopic).isEqualTo(FirmwareTopics.telemetryCommandTopic("M01"));
        assertThat(fixture.publisher.lastPayload).containsEntry("action", "START");
        assertThat(fixture.publisher.lastPayload).containsEntry("interval_ms", 200);
        assertThat(fixture.publisher.lastPayload).containsKey("request_id");
        assertThat(fixture.publisher.lastPayload).containsKey("issued_at_ms");
    }

    @Test
    void duplicateStartIsIdempotentAndDoesNotPublishTwice() {
        Fixture fixture = newFixture();

        ResponseEntity<?> first = fixture.controller.startTelemetry(null, "M01", Map.of("interval_ms", 200));
        ResponseEntity<?> duplicate = fixture.controller.startTelemetry(null, "M01", Map.of("interval_ms", 200));

        assertThat(first.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
        assertThat(duplicate.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
        assertThat(fixture.publisher.publishCount).isEqualTo(1);
        @SuppressWarnings("unchecked")
        Map<String, Object> duplicateBody = (Map<String, Object>) duplicate.getBody();
        assertThat(duplicateBody).containsEntry("idempotent", true);
    }

    @Test
    void stopTelemetryPublishesStopWithoutSessionFields() {
        Fixture fixture = newFixture();

        ResponseEntity<?> response = fixture.controller.stopTelemetry(null, "M01");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
        assertThat(fixture.publisher.lastTopic).isEqualTo(FirmwareTopics.telemetryCommandTopic("M01"));
        assertThat(fixture.publisher.lastPayload).containsEntry("action", "STOP");
        assertThat(fixture.publisher.lastPayload).doesNotContainKeys("interval_ms", "session_id", "sessionId");
    }

    @Test
    void latestTelemetryReturnsLatestDiagnosticsSnapshot() {
        Fixture fixture = newFixture();
        fixture.sensorStreamService.recordSnapshot(new SensorStreamSnapshot(
                "M01",
                "SENSOR_STREAM",
                "PAIRED_IDLE",
                1244088,
                true,
                3279680,
                true,
                -999999,
                false,
                2783,
                true,
                0.82,
                true,
                1.44,
                false,
                1.39,
                true,
                true,
                12.6,
                0.42,
                true,
                2,
                200,
                124700L,
                Instant.parse("2026-07-10T00:00:00Z")
        ));

        ResponseEntity<?> response = fixture.controller.latestTelemetry(null, "M01");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        @SuppressWarnings("unchecked")
        Map<String, Object> body = (Map<String, Object>) response.getBody();
        assertThat(body).containsEntry("device_id", "M01");
        assertThat(body).containsEntry("stream_observed", true);
        assertThat(body).containsKey("latest_snapshot");
    }

    private static Fixture newFixture() {
        ObjectMapper objectMapper = new ObjectMapper();
        FirmwarePersistenceRepository repository = new FirmwarePersistenceRepository(
                Path.of("target", "device-telemetry-controller-test-" + UUID.randomUUID() + ".sqlite").toString()
        );
        repository.initialize();
        CapturingPublisher publisher = new CapturingPublisher(objectMapper, repository);
        SensorStreamService sensorStreamService = new SensorStreamService();
        return new Fixture(
                publisher,
                sensorStreamService,
                new DeviceTelemetryController(
                        new AllowingAuthService(objectMapper),
                        publisher,
                        sensorStreamService
                )
        );
    }

    private static final class CapturingPublisher extends MqttCommandPublisherService {
        private String lastTopic;
        private Map<String, Object> lastPayload;
        private int publishCount;

        private CapturingPublisher(ObjectMapper objectMapper, FirmwarePersistenceRepository repository) {
            super(objectMapper, repository, "tcp://127.0.0.1:1", "test-publisher");
        }

        @Override
        protected void ensureConnected() {
        }

        @Override
        protected void publishToBroker(String topic, String jsonPayload) {
            this.lastTopic = topic;
        }

        @Override
        protected FirmwareCommandPublishResult publishFirmwareCommand(
                String topic,
                Map<String, Object> payload,
                String action,
                FirmwareCommandTypeId commandTypeId
        ) {
            this.lastPayload = Map.copyOf(payload);
            this.publishCount++;
            return super.publishFirmwareCommand(topic, payload, action, commandTypeId);
        }
    }

    private static final class AllowingAuthService extends AuthService {
        private AllowingAuthService(ObjectMapper objectMapper) {
            super(
                    new LocalAuthRepository(Path.of("target", "device-telemetry-auth-test-" + UUID.randomUUID() + ".sqlite").toString()),
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

    private record Fixture(CapturingPublisher publisher, SensorStreamService sensorStreamService, DeviceTelemetryController controller) {
    }
}
