package lk.resq.localhub.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.model.firmware.FirmwareCalibrationResultRecord;
import lk.resq.localhub.model.firmware.FirmwareCommandPublishResponse;
import lk.resq.localhub.model.firmware.FirmwareCommandRequestRecord;
import lk.resq.localhub.model.firmware.FirmwareCommandTypeId;
import lk.resq.localhub.model.firmware.FirmwareDebugSnapshotRecord;
import lk.resq.localhub.model.firmware.FirmwareDeviceDiagnosticsResponse;
import lk.resq.localhub.model.firmware.FirmwareEventRecord;
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
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.Objects;

import static org.assertj.core.api.Assertions.assertThat;

class FirmwareDiagnosticsControllerTest {

    @Test
    void commandsEndpointClampsLimitAndReturnsRecentCommands() {
        Fixture fixture = newFixture();
        seedCommands(fixture.repository, "M01", 120);

        ResponseEntity<?> response = fixture.controller.recentCommands(null, "M01", 999);

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        List<FirmwareCommandRequestRecord> commands = requireBody(response.getBody());
        assertThat(commands).hasSize(100);
        assertThat(commands.get(0).requestId()).isEqualTo("req-119");
    }

    @Test
    void eventsEndpointReturnsRecentEvents() {
        Fixture fixture = newFixture();
        seedEvent(fixture.repository, "M01", 2000, "events", "SESSION_ACTIVE");
        seedEvent(fixture.repository, "M01", 2001, "events", "READY_FOR_SESSION");

        ResponseEntity<?> response = fixture.controller.recentEvents(null, "M01", 50);

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        List<FirmwareEventRecord> events = requireBody(response.getBody());
        assertThat(events).hasSize(2);
        assertThat(events.get(0).eventId()).isEqualTo(2001);
        assertThat(events.get(0).topicFamily()).isEqualTo("events");
    }

    @Test
    void debugSnapshotsEndpointReturnsRecentSnapshots() {
        Fixture fixture = newFixture();
        seedDebugSnapshot(fixture.repository, "M01", 77, 88, 99, 111, 1234L);

        ResponseEntity<?> response = fixture.controller.recentDebugSnapshots(null, "M01", 20);

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        List<FirmwareDebugSnapshotRecord> snapshots = requireBody(response.getBody());
        assertThat(snapshots).hasSize(1);
        assertThat(snapshots.get(0).pressure0Raw()).isEqualTo(77);
        assertThat(snapshots.get(0).hallRaw()).isEqualTo(111);
    }

    @Test
    void diagnosticsEndpointIncludesReadinessHistoryAndLiveSummary() throws Exception {
        Fixture fixture = newFixture();
        fixture.registry.updateFromStatus("M01", fixture.objectMapper.readTree("""
            {
              "state": "READY_FOR_SESSION",
              "sessionId": "S-9",
              "sessionActive": false,
              "fw": "1.2.3"
            }
            """));
        seedCalibration(fixture.repository, "M01", "PASS", true, "READY_FOR_SESSION", 4002, "req-400-0001");
        seedCommands(fixture.repository, "M01", 1);
        seedEvent(fixture.repository, "M01", 2000, "events", "SESSION_ACTIVE");
        seedDebugSnapshot(fixture.repository, "M01", 1, 2, 3, 4, 5000L);

        ResponseEntity<?> response = fixture.controller.diagnostics(null, "M01");

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        FirmwareDeviceDiagnosticsResponse body = requireBody(response.getBody());
        assertThat(body.readiness().firmwareState()).isEqualTo("READY_FOR_SESSION");
        assertThat(body.latestCalibration().result()).isEqualTo("PASS");
        assertThat(body.liveSummary()).isNotNull();
        assertThat(body.liveSummary().state()).isEqualTo("READY_FOR_SESSION");
        assertThat(body.recentCommands()).isNotEmpty();
        assertThat(body.recentEvents()).isNotEmpty();
        assertThat(body.recentDebugSnapshots()).isNotEmpty();
    }

    @Test
    void debugEndpointPublishesCanonicalDebugCommand() {
        Fixture fixture = newFixture();

        ResponseEntity<?> response = fixture.controller.requestDebugSnapshot(null, "M01");

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        FirmwareCommandPublishResponse body = requireBody(response.getBody());
        assertThat(body.topic()).isEqualTo(FirmwareTopics.debugCommandTopic("M01"));
        assertThat(fixture.publisher.lastCommandTypeId).isEqualTo(FirmwareCommandTypeId.DEBUG);
    }

    @SuppressWarnings("unchecked")
    private static <T> T requireBody(Object body) {
        return (T) Objects.requireNonNull(body, "response body must not be null");
    }

    private static Fixture newFixture() {
        ObjectMapper objectMapper = new ObjectMapper();
        FirmwarePersistenceRepository repository = new FirmwarePersistenceRepository(
                Path.of("target", "firmware-diagnostics-controller-test-" + UUID.randomUUID() + ".sqlite").toString()
        );
        repository.initialize();
        CalibrationProfileRepository profileRepository = new CalibrationProfileRepository(
            Path.of("target", "firmware-diagnostics-controller-profile-" + UUID.randomUUID() + ".sqlite").toString()
        );
        profileRepository.initialize();
        CalibrationProfileFingerprintService fingerprintService = new CalibrationProfileFingerprintService();
        CalibrationProfileService profileService = new CalibrationProfileService(profileRepository, fingerprintService);
        CapturingPublisher publisher = new CapturingPublisher(objectMapper, repository);
        ManikinRegistryService registry = new ManikinRegistryService(12);
        FirmwareCalibrationService calibrationService = new FirmwareCalibrationService(publisher, repository, profileService, registry, fingerprintService);
        FirmwareDiagnosticsController controller = new FirmwareDiagnosticsController(
                new AllowingAuthService(objectMapper),
                calibrationService,
                repository,
                publisher,
                registry
        );
        return new Fixture(objectMapper, repository, publisher, registry, controller);
    }

    private static void seedCommands(FirmwarePersistenceRepository repository, String deviceId, int count) {
        Instant baseTime = Instant.parse("2026-05-23T10:15:30Z");
        for (int i = 0; i < count; i++) {
            String requestId = "req-%03d".formatted(i);
            repository.recordCommandRequest(new FirmwareCommandRequestRecord(
                    requestId,
                    deviceId,
                    FirmwareCommandTypeId.SYSTEM_RESET.value(),
                    "SYSTEM_RESET",
                    FirmwareTopics.systemResetCommandTopic(deviceId),
                    "{}",
                    "PUBLISHED",
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    baseTime.plusSeconds(i),
                    baseTime.plusSeconds(i).plusMillis(500),
                    null,
                    null,
                    baseTime.plusSeconds(i).plusMillis(500)
            ));
        }
    }

    private static void seedEvent(FirmwarePersistenceRepository repository, String deviceId, int eventId, String topicFamily, String state) {
        repository.saveFirmwareEvent(new FirmwareEventRecord(
                0L,
                deviceId,
                "resq/" + deviceId + "/" + topicFamily,
                topicFamily,
                eventId,
                null,
                null,
                "ACK",
                state,
                "00000",
                1,
                2,
                state,
                "S-1",
                123L,
                Instant.parse("2026-05-23T10:15:30Z"),
                "{}"
        ));
    }

    private static void seedDebugSnapshot(FirmwarePersistenceRepository repository, String deviceId, int pressure0, int pressure1, int pressure2, int hall, Long tsMs) {
        repository.saveDebugSnapshot(new FirmwareDebugSnapshotRecord(
                0L,
                deviceId,
                null,
                pressure0,
                pressure1,
                pressure2,
                hall,
                tsMs,
                Instant.parse("2026-05-23T10:15:30Z"),
                "{}"
        ));
    }

    private static void seedCalibration(FirmwarePersistenceRepository repository, String deviceId, String result, boolean calibrated, String firmwareState, int eventId, String requestId) {
        repository.saveCalibrationResult(new FirmwareCalibrationResultRecord(
                0L,
                deviceId,
                "default",
                requestId,
                requestId,
                eventId,
                result,
                "ACK",
                1,
                "00000",
                1,
                firmwareState,
                calibrated,
                5000L,
                Instant.parse("2026-05-23T10:15:30Z"),
                "{}"
        ));
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
                    new LocalAuthRepository(Path.of("target", "firmware-diagnostics-auth-test-" + UUID.randomUUID() + ".sqlite").toString()),
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

    private record Fixture(ObjectMapper objectMapper, FirmwarePersistenceRepository repository, CapturingPublisher publisher, ManikinRegistryService registry, FirmwareDiagnosticsController controller) {
    }
}
