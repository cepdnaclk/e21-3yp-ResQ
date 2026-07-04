package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.localhub.model.SessionStartRequest;
import lk.resq.localhub.model.firmware.CalibrationState;
import lk.resq.localhub.model.firmware.CalibrationMqttEvent;
import lk.resq.localhub.model.firmware.CalibrationStreamEvent;
import lk.resq.localhub.model.firmware.DeviceReadinessState;
import lk.resq.localhub.model.firmware.FirmwareCalibrationResultRecord;
import lk.resq.localhub.model.firmware.FirmwareCommandRequestRecord;
import lk.resq.localhub.model.firmware.FirmwareDebugSnapshotRecord;
import lk.resq.localhub.model.firmware.FirmwareEventRecord;
import lk.resq.localhub.model.firmware.FirmwareCommandTypeId;
import lk.resq.localhub.service.CalibrationProfileRepository;
import lk.resq.localhub.service.CalibrationProfileService;
import lk.resq.localhub.service.SyncQueueRepository;
import lk.resq.localhub.service.SyncQueueService;
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

    private final ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();

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
        assertThat(liveView.latestDepthMm()).isEqualTo(39.0);
        assertThat(liveView.latestMetric()).isNotNull();
        assertThat(liveView.latestMetric().depthProgress()).isEqualTo(0.78);
        assertThat(liveView.latestMetric().depthOk()).isTrue();
        assertThat(liveView.latestRateCpm()).isEqualTo(111.0);
        assertThat(liveView.latestRecoilOk()).isNull();
        assertThat(liveView.latestMetric().compressionCount()).isEqualTo(1);
        assertThat(liveView.latestMetric().validCompressionCount()).isZero();
        assertThat(liveView.latestMetric().recoilOkCount()).isZero();
        assertThat(liveView.latestMetric().incompleteRecoilCount()).isZero();
        assertThat(liveView.latestMetric().handPlacement()).isEqualTo("CENTER");
        assertThat(liveView.latestMetric().pressureBalancePct()).isEqualTo(92.9);
        assertThat(liveView.pressureBalancePct()).isEqualTo(92.9);
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

    @Test
    void tracksDeviceReadinessFromMqttEvents() throws Exception {
        ServiceFixture fixture = newFixture(newRepository());
        MqttSubscriberService subscriber = fixture.subscriber();
        DeviceReadinessService readinessService = fixture.readinessService();

        // 1. Send Event 4000 ACK
        subscriber.handleMessage("resq/M01/events/calibration", message("""
            {
              "event_id": 4000,
              "reply_id": "req-200-0001",
              "status": "ACK",
              "state": "CALIBRATING",
              "ts_ms": 123456
            }
            """));
        DeviceReadinessState state = readinessService.getReadiness("M01");
        assertThat(state.calibrationState()).isEqualTo(CalibrationState.CALIBRATING);
        assertThat(state.currentProgressId()).isEqualTo(1);
        assertThat(state.readyForSession()).isFalse();

        // 2. Send Event 4001 progress 2
        subscriber.handleMessage("resq/manikins/M01/events/calibration", message("""
            {
              "event_id": 4001,
              "progress_id": 2,
              "reason_id": "00000",
              "state": "CALIBRATING",
              "action_id": 0,
              "ts_ms": 123456
            }
            """));
        state = readinessService.getReadiness("M01");
        assertThat(state.calibrationState()).isEqualTo(CalibrationState.CALIBRATING);
        assertThat(state.currentProgressId()).isEqualTo(2);
        assertThat(state.readyForSession()).isFalse();

        // 3. Send Event 4002 result PASS
        subscriber.handleMessage("resq/M01/events/calibration", message("""
            {
              "event_id": 4002,
              "reply_id": "req-200-0001",
              "status": "ACK",
              "result": "PASS",
              "reason_id": "00000",
              "state": "READY_FOR_SESSION",
              "action_id": 0,
              "ts_ms": 123456
            }
            """));
        state = readinessService.getReadiness("M01");
        assertThat(state.calibrationState()).isEqualTo(CalibrationState.READY);
        assertThat(state.readyForSession()).isTrue();
    }

    @Test
    void verifiesCalibrationSseBroadcasts() throws Exception {
        ServiceFixture fixture = newFixture(newRepository());
        MqttSubscriberService subscriber = fixture.subscriber();
        CapturingCalibrationStreamService streamService = fixture.calibrationStreamService();

        // 1. Send Event 4001 progress 2
        subscriber.handleMessage("resq/M01/events/calibration", message("""
            {
              "event_id": 4001,
              "progress_id": 2,
              "reason_id": "00000",
              "state": "CALIBRATING",
              "action_id": 0,
              "ts_ms": 123456
            }
            """));
        assertThat(streamService.events).hasSize(1);
        CalibrationStreamEvent updateEvent = streamService.events.get(0);
        assertThat(updateEvent.type()).isEqualTo("calibration_update");
        assertThat(updateEvent.eventId()).isEqualTo(4001);
        assertThat(updateEvent.progressId()).isEqualTo(2);

        // 2. Send Event 4002 result PASS
        subscriber.handleMessage("resq/M01/events/calibration", message("""
            {
              "event_id": 4002,
              "reply_id": "req-200-0001",
              "status": "ACK",
              "result": "PASS",
              "reason_id": "00000",
              "state": "READY_FOR_SESSION",
              "action_id": 0,
              "ts_ms": 123456
            }
            """));
        assertThat(streamService.events).hasSize(2);
        CalibrationStreamEvent finalEvent = streamService.events.get(1);
        assertThat(finalEvent.type()).isEqualTo("calibration_final");
        assertThat(finalEvent.eventId()).isEqualTo(4002);
        assertThat(finalEvent.readyForSession()).isTrue();
    }

    @Test
    void verifiesTelemetryWithDerivedRatePressureBalanceDepthProgressAndSsePublishing() throws Exception {
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

        // 1. Initial telemetry sample (start state)
        fixture.subscriber().handleMessage("resq/M01/telemetry", message("""
            {
              "session_id": "%s",
              "ts_ms": 1000,
              "depth_progress": 0.05,
              "pressure_balance_pct": 91.5
            }
            """.formatted(session.sessionId())));

        // 2. Crosses 0.2 depth progress (start of compression 1)
        fixture.subscriber().handleMessage("resq/M01/telemetry", message("""
            {
              "session_id": "%s",
              "ts_ms": 1100,
              "depth_progress": 0.25,
              "pressure_balance_pct": 91.5
            }
            """.formatted(session.sessionId())));

        // 3. Resets back below 0.1 depth progress (rearms)
        fixture.subscriber().handleMessage("resq/M01/telemetry", message("""
            {
              "session_id": "%s",
              "ts_ms": 1300,
              "depth_progress": 0.05,
              "pressure_balance_pct": 91.5
            }
            """.formatted(session.sessionId())));

        // 4. Crosses 0.2 depth progress again (start of compression 2)
        // Interval is 1600 - 1100 = 500 ms -> rate is 60000 / 500 = 120 cpm
        fixture.subscriber().handleMessage("resq/M01/telemetry", message("""
            {
              "session_id": "%s",
              "ts_ms": 1600,
              "depth_progress": 0.25,
              "pressure_balance_pct": 91.5
            }
            """.formatted(session.sessionId())));

        // Check active session live view
        var liveView = fixture.activeSessionService().getSessionLiveView(session.sessionId()).orElseThrow();
        assertThat(liveView.pressureBalancePct()).isEqualTo(91.5);
        assertThat(liveView.latestMetric().depthProgress()).isEqualTo(0.25);
        assertThat(liveView.latestRateCpm()).isEqualTo(120.0);

        // Check captured trainee SSE outputs
        var capturedViews = fixture.liveStreamService().getSessionLiveViews();
        assertThat(capturedViews).isNotEmpty();
        var lastView = capturedViews.get(capturedViews.size() - 1);
        assertThat(lastView.sessionId()).isEqualTo(session.sessionId());
        assertThat(lastView.traineeId()).isEqualTo("trainee-1");
        assertThat(lastView.pressureBalancePct()).isEqualTo(91.5);
        assertThat(lastView.latestRateCpm()).isEqualTo(120.0);
    }

    private MqttSubscriberService newService(FirmwarePersistenceRepository repository) throws Exception {
        return newFixture(repository).subscriber();
    }

    private ServiceFixture newFixture(FirmwarePersistenceRepository repository) throws Exception {
        ManikinRegistryService registry = new ManikinRegistryService(12);
        MqttCommandPublisherService commandPublisher = new NoopMqttCommandPublisherService(repository);
        LocalSessionRepository sessionRepository = new InMemoryLocalSessionRepository();
        CapturingLiveStreamService liveStreamService = new CapturingLiveStreamService();
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
        SyncQueueRepository syncQueueRepository = new SyncQueueRepository(
            Path.of("target", "mqtt-subscriber-sync-test-" + UUID.randomUUID() + ".sqlite").toString()
        );
        syncQueueRepository.initialize();
        SyncQueueService syncQueueService = new SyncQueueService(
                syncQueueRepository,
                objectMapper,
                new CloudSessionSummaryPayloadMapper()
        );
        DeviceReadinessService readinessService = new DeviceReadinessService();
        readinessService.handleCalibrationEvent("M01", new CalibrationMqttEvent(
                "M01",
                4002,
                "reply-m01",
                "ACK",
                11,
                "PASS",
                "00000",
                0,
                "READY_FOR_SESSION",
                100L,
                Instant.now()
        ));
        ActiveSessionService activeSessionService = new ActiveSessionService(
                registry,
                commandPublisher,
                sessionRepository,
                liveStreamService,
                traineeRecordsRepository,
                firmwareCalibrationService,
                syncQueueService,
                null,
                new RateEstimatorRegistry(),
                readinessService
        );
        CapturingCalibrationStreamService calibrationStreamService = new CapturingCalibrationStreamService(readinessService);
        MqttSubscriberService subscriber = new MqttSubscriberService(
                objectMapper,
                registry,
                activeSessionService,
                liveStreamService,
                repository,
                readinessService,
                calibrationStreamService,
                "tcp://127.0.0.1:1",
                "test-subscriber",
                null,
                null
        );
        return new ServiceFixture(subscriber, activeSessionService, liveStreamService, readinessService, calibrationStreamService);
    }

    private record ServiceFixture(
            MqttSubscriberService subscriber,
            ActiveSessionService activeSessionService,
            CapturingLiveStreamService liveStreamService,
            DeviceReadinessService readinessService,
            CapturingCalibrationStreamService calibrationStreamService
    ) {
    }

    private static class CapturingCalibrationStreamService extends CalibrationStreamService {
        private final List<CalibrationStreamEvent> events = new java.util.ArrayList<>();

        private CapturingCalibrationStreamService(DeviceReadinessService readinessService) {
            super(readinessService);
        }

        @Override
        public void publishCalibrationUpdate(String deviceId, CalibrationMqttEvent event, DeviceReadinessState readiness) {
            events.add(CalibrationStreamEvent.update(deviceId, event, readiness));
        }
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

    private static final class CapturingLiveStreamService extends LiveStreamService {
        private final List<lk.resq.localhub.model.SessionLiveView> sessionLiveViews = new java.util.ArrayList<>();

        @Override
        public void publishSessionLive(String sessionId, lk.resq.localhub.model.SessionLiveView payload) {
            if (payload != null) {
                sessionLiveViews.add(payload);
            }
        }

        public List<lk.resq.localhub.model.SessionLiveView> getSessionLiveViews() {
            return sessionLiveViews;
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
