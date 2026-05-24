package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.localhub.model.SessionStartRequest;
import lk.resq.localhub.model.firmware.FirmwareCalibrationResultRecord;
import lk.resq.localhub.model.firmware.FirmwareCommandRequestRecord;
import lk.resq.localhub.model.firmware.FirmwareDebugSnapshotRecord;
import lk.resq.localhub.model.firmware.FirmwareEventRecord;
import lk.resq.localhub.model.firmware.FirmwareCommandTypeId;
import lk.resq.localhub.service.CalibrationProfileRepository;
import lk.resq.localhub.service.CalibrationProfileService;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Instant;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class MqttSubscriberServiceTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void parsesCanonicalAndLegacyFirmwareTopics() throws Exception {
        MqttSubscriberService service = newService(newRepository());

        assertThat(service.parseTopic("resq/M01/status")).isNotNull();
        assertThat(service.parseTopic("resq/M01/status").messageType()).isEqualTo("status");
        assertThat(service.parseTopic("resq/M01/status").canonicalFirmwareTopic()).isTrue();
        assertThat(service.parseTopic("resq/M01/events/calibration").messageType()).isEqualTo("events/calibration");
        assertThat(service.parseTopic("resq/M01/events/calibration").canonicalFirmwareTopic()).isTrue();
        assertThat(service.parseTopic("resq/M01/events/error").messageType()).isEqualTo("events/error");
        assertThat(service.parseTopic("resq/manikins/M01/live").messageType()).isEqualTo("telemetry");
        assertThat(service.parseTopic("resq/manikins/M01/live").canonicalFirmwareTopic()).isFalse();
        assertThat(service.parseTopic("resq/manikins/M01/events").messageType()).isEqualTo("events");
        assertThat(service.parseTopic("resq/manikins/M01/events/calibration").messageType()).isEqualTo("events/calibration");
        assertThat(service.parseTopic("other/M01/status")).isNull();
    }

    @Test
    void persistsEventReplyAndCalibrationSnapshots() throws Exception {
        FirmwarePersistenceRepository repository = newRepository();
        seedCommand(repository, "req-400-0001", "M01", FirmwareCommandTypeId.SYSTEM_RESET.value(), "resq/M01/cmd/system/reset");
        MqttSubscriberService service = newService(repository);

        service.handleMessage("resq/M01/events", message("""
            {
              "event_id": 1003,
              "reply_id": "req-400-0001",
              "status": "ACK",
              "reason_id": "00000",
              "action_id": 7,
              "session_id": "S-1",
              "ts_ms": 101
            }
            """));

        FirmwareCommandRequestRecord command = repository.findCommandByRequestId("req-400-0001").orElseThrow();
        assertThat(command.replyId()).isEqualTo("req-400-0001");
        assertThat(command.replyStatus()).isEqualTo("ACK");
        assertThat(command.status()).isEqualTo("ACK");
        assertThat(command.completedAt()).isNotNull();

        List<FirmwareEventRecord> events = repository.findRecentEvents("M01", 10);
        assertThat(events).hasSize(1);
        assertThat(events.get(0).eventId()).isEqualTo(1003);
        assertThat(events.get(0).topicFamily()).isEqualTo("events");
        assertThat(events.get(0).replyId()).isEqualTo("req-400-0001");

        service.handleMessage("resq/M01/events/calibration", message("""
            {
              "event_id": 4002,
              "reply_id": "req-400-0002",
              "status": "ACK",
              "result": "PASS",
              "progress_id": 11,
              "reason_id": "00000",
              "action_id": 1,
              "profile_id": "adult-training",
              "state": "CALIBRATED",
              "ts_ms": 102
            }
            """));

        FirmwareCalibrationResultRecord calibrated = repository.findLatestCalibrationResult("M01").orElseThrow();
        assertThat(calibrated.eventId()).isEqualTo(4002);
        assertThat(calibrated.result()).isEqualTo("PASS");
        assertThat(calibrated.calibrated()).isTrue();
        assertThat(calibrated.progressId()).isEqualTo(11);
        assertThat(calibrated.profileId()).isEqualTo("adult-training");
    }

    @Test
    void savesFailingCalibrationAndDebugSnapshotsAndUnknownEvents() throws Exception {
        FirmwarePersistenceRepository repository = newRepository();
        MqttSubscriberService service = newService(repository);

        service.handleMessage("resq/M01/events/calibration", message("""
            {
              "event_id": 4002,
              "reply_id": "req-400-0003",
              "status": "NACK",
              "result": "FAIL",
              "progress_id": 12,
              "reason_id": "12345",
              "action_id": 8,
              "state": "CALIBRATION_FAILED",
              "ts_ms": 201
            }
            """));

        FirmwareCalibrationResultRecord calibration = repository.findLatestCalibrationResult("M01").orElseThrow();
        assertThat(calibration.result()).isEqualTo("FAIL");
        assertThat(calibration.calibrated()).isFalse();
        assertThat(calibration.reasonId()).isEqualTo("12345");

        service.handleMessage("resq/M01/debug", message("""
            {
              "pressure_0_raw": 101,
              "pressure_1_raw": 202,
              "pressure_2_raw": 303,
              "hall_raw": 404,
              "ts_ms": 301
            }
            """));

        List<FirmwareDebugSnapshotRecord> snapshots = repository.findDebugSnapshots("M01", 10);
        assertThat(snapshots).hasSize(1);
        assertThat(snapshots.get(0).pressure0Raw()).isEqualTo(101);
        assertThat(snapshots.get(0).hallRaw()).isEqualTo(404);
        assertThat(snapshots.get(0).requestId()).isNull();

        service.handleMessage("resq/M01/events", message("""
            {
              "event_id": 9999,
              "session_id": "S-UNKNOWN",
              "status": "ACK",
              "ts_ms": 401
            }
            """));

        assertThat(repository.findRecentEvents("M01", 10)).extracting(FirmwareEventRecord::eventId).contains(9999);
    }

    @Test
    void acceptsCanonicalTelemetryWithoutPayloadDeviceIdUsingTopicDeviceId() throws Exception {
        ServiceFixture fixture = newFixture(newRepository());
        var session = fixture.activeSessionService().startSession(new SessionStartRequest(
                "M01",
                "trainee-1",
                null,
                null,
                null,
                "smoke-test",
                null
        ));

        fixture.subscriber().handleMessage("resq/M01/telemetry", message("""
            {
              "session_id": "%s",
              "state": "SESSION_ACTIVE",
              "depth_progress": 0.78,
              "depth_ok": true,
              "rate_cpm": 111,
              "compression_count": 1,
              "valid_compression_count": 0,
              "recoil_ok_count": 0,
              "incomplete_recoil_count": 0,
              "pause_s": 0.2,
              "hand_placement": "CENTER",
              "pressure_balance_pct": 92.9,
              "flags": "DEPTH_OK,RATE_OK,RECOIL_OK",
              "ts_ms": 100432
            }
            """.formatted(session.sessionId())));

        var liveView = fixture.activeSessionService().getSessionLiveView(session.sessionId()).orElseThrow();
        assertThat(liveView.deviceId()).isEqualTo("M01");
        assertThat(liveView.latestDepthMm()).isNull();
        assertThat(liveView.latestMetric()).isNotNull();
        assertThat(liveView.latestMetric().depthProgress()).isEqualTo(0.78);
        assertThat(liveView.latestRateCpm()).isEqualTo(111.0);
        assertThat(liveView.latestRecoilOk()).isTrue();
        assertThat(liveView.latestFlags()).isEqualTo("DEPTH_OK,RATE_OK,RECOIL_OK");
    }

    @Test
    void rejectsCanonicalTelemetryWhenPayloadDeviceIdConflictsWithTopicDeviceId() throws Exception {
        ServiceFixture fixture = newFixture(newRepository());
        var session = fixture.activeSessionService().startSession(new SessionStartRequest(
                "M01",
                "trainee-1",
                null,
                null,
                null,
                "smoke-test",
                null
        ));

        fixture.subscriber().handleMessage("resq/M01/telemetry", message("""
            {
              "device_id": "M02",
              "session_id": "%s",
              "depth_progress": 0.78,
              "depth_ok": true,
              "rate_cpm": 111
            }
            """.formatted(session.sessionId())));

        var liveView = fixture.activeSessionService().getSessionLiveView(session.sessionId()).orElseThrow();
        assertThat(liveView.latestDepthMm()).isNull();
        assertThat(liveView.latestRateCpm()).isNull();
    }

    private MqttSubscriberService newService(FirmwarePersistenceRepository repository) throws Exception {
        return newFixture(repository).subscriber();
    }

    private ServiceFixture newFixture(FirmwarePersistenceRepository repository) throws Exception {
        ManikinRegistryService registry = new ManikinRegistryService(12);
        MqttCommandPublisherService commandPublisher = new NoopMqttCommandPublisherService(repository);
        LocalSessionRepository sessionRepository = new InMemoryLocalSessionRepository();
        LiveStreamService liveStreamService = new NoopLiveStreamService();
        TraineeRecordsRepository traineeRecordsRepository = new TraineeRecordsRepository();
        CalibrationProfileRepository profileRepository = new CalibrationProfileRepository(
            Path.of("target", "mqtt-subscriber-calibration-test-" + UUID.randomUUID() + ".sqlite").toString()
        );
        profileRepository.initialize();
        CalibrationProfileService profileService = new CalibrationProfileService(profileRepository);
        FirmwareCalibrationService firmwareCalibrationService = new FirmwareCalibrationService(
                commandPublisher,
                repository,
            profileService,
                registry
        );
        ActiveSessionService activeSessionService = new ActiveSessionService(
                registry,
                commandPublisher,
                sessionRepository,
                liveStreamService,
                traineeRecordsRepository,
                firmwareCalibrationService
        );

        MqttSubscriberService subscriber = new MqttSubscriberService(
                objectMapper,
                registry,
                activeSessionService,
                liveStreamService,
                repository,
                "tcp://127.0.0.1:1",
                "test-subscriber",
                null,
                null
        );
        return new ServiceFixture(subscriber, activeSessionService);
    }

    private record ServiceFixture(MqttSubscriberService subscriber, ActiveSessionService activeSessionService) {
    }

    private static final class NoopMqttCommandPublisherService extends MqttCommandPublisherService {
        private NoopMqttCommandPublisherService(FirmwarePersistenceRepository repository) {
            super(new ObjectMapper(), repository, "tcp://127.0.0.1:1", "test");
        }

        @Override
        protected void ensureConnected() {
        }

        @Override
        public void publishSessionStart(lk.resq.localhub.model.SessionStartCommandPayload payload) {
        }

        @Override
        public void publishSessionStop(lk.resq.localhub.model.SessionStopCommandPayload payload) {
        }
    }

    private static final class InMemoryLocalSessionRepository extends LocalSessionRepository {
        private InMemoryLocalSessionRepository() {
            super("target/mqtt-subscriber-service-test.sqlite");
        }

        @Override
        public synchronized void save(lk.resq.localhub.model.SessionEndResponse session) {
        }

        @Override
        public synchronized Optional<lk.resq.localhub.model.SessionEndResponse> findById(String sessionId) {
            return Optional.empty();
        }

        @Override
        public synchronized List<lk.resq.localhub.model.SessionEndResponse> findAll() {
            return List.of();
        }
    }

    private static final class NoopLiveStreamService extends LiveStreamService {
        @Override
        public void publishSessionLive(String sessionId, lk.resq.localhub.model.SessionLiveView payload) {
        }
    }

    private static FirmwarePersistenceRepository newRepository() {
        FirmwarePersistenceRepository repository = new FirmwarePersistenceRepository(
                Path.of("target", "firmware-subscriber-test-" + UUID.randomUUID() + ".sqlite").toString()
        );
        repository.initialize();
        return repository;
    }

    private static void seedCommand(FirmwarePersistenceRepository repository, String requestId, String deviceId, int commandTypeId, String topic) {
        repository.recordCommandRequest(new FirmwareCommandRequestRecord(
                requestId,
                deviceId,
                commandTypeId,
                "SYSTEM_RESET",
                topic,
                "{\"request_id\":\"%s\"}".formatted(requestId),
                "PUBLISHED",
                null,
                null,
                null,
                null,
                null,
                null,
                Instant.now(),
                Instant.now(),
                null,
                Instant.now().plusSeconds(120),
                Instant.now()
        ));
    }

    private MqttMessage message(String json) {
        return new MqttMessage(json.getBytes(StandardCharsets.UTF_8));
    }
}
