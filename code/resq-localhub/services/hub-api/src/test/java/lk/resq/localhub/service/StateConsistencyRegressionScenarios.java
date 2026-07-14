package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.localhub.model.ManikinLiveSummary;
import lk.resq.localhub.model.SessionEndResponse;
import lk.resq.localhub.model.SessionStartCommandPayload;
import lk.resq.localhub.model.SessionStartRequest;
import lk.resq.localhub.model.SessionStartResponse;
import lk.resq.localhub.model.firmware.CalibrationMqttEvent;
import lk.resq.localhub.model.firmware.CalibrationState;
import lk.resq.localhub.model.firmware.CalibrationStreamEvent;
import lk.resq.localhub.model.firmware.DeviceReadinessState;
import lk.resq.localhub.model.firmware.FirmwareCommandTypeId;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Tag("state-consistency-regression")
class StateConsistencyRegressionScenarios {

    private final ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();

    @Test
    void historicalPassMustNotOverrideLaterPairedIdleStatus_futureBehavior() throws Exception {
        ServiceFixture fixture = newFixture();

        fixture.subscriber().handleMessage("resq/M01/events/calibration", message(fixture("calibration-pass-4002.json")));
        fixture.subscriber().handleMessage("resq/M01/status", message(fixture("status-paired-idle.json")));

        DeviceReadinessState readiness = fixture.readinessService().getReadiness("M01");
        ManikinLiveSummary live = fixture.registry().getLiveSummary("M01").orElseThrow();

        assertThat(live.state()).isEqualTo("PAIRED_IDLE");
        assertThat(live.calibrated()).isFalse();
        assertThat(readiness.lastResult()).isEqualTo("PASS");
        assertThat(readiness.firmwareState()).isEqualTo("PAIRED_IDLE");
        assertThat(readiness.readyForSession())
                .as("Phase 1: retained PAIRED_IDLE calibrated=false must clear current readiness without deleting historical PASS")
                .isFalse();
    }

    @Test
    void retainedReadyForSessionStatusRestoresSessionGate_futureBehavior() throws Exception {
        ServiceFixture fixture = newFixture();

        fixture.subscriber().handleMessage("resq/M01/status", message(fixture("status-ready-for-session.json")));

        DeviceReadinessState readiness = fixture.readinessService().getReadiness("M01");
        ManikinLiveSummary live = fixture.registry().getLiveSummary("M01").orElseThrow();

        assertThat(live.state()).isEqualTo("READY_FOR_SESSION");
        assertThat(live.calibrated()).isTrue();
        assertThat(readiness.firmwareState()).isEqualTo("READY_FOR_SESSION");
        assertThat(readiness.readyForSession())
                .as("Phase 1: retained READY_FOR_SESSION should rebuild memory-only session gate after backend restart")
                .isTrue();
    }

    @Test
    void backendRestartWithPairedIdleKeepsHistoryButCurrentReadinessFalse_futureBehavior() throws Exception {
        ServiceFixture beforeRestart = newFixture();
        beforeRestart.subscriber().handleMessage("resq/M01/events/calibration", message(fixture("calibration-pass-4002.json")));
        assertThat(beforeRestart.repository().findLatestCalibrationResult("M01")).isPresent();

        ServiceFixture afterRestart = newFixture(beforeRestart.repository());
        afterRestart.subscriber().handleMessage("resq/M01/status", message(fixture("status-paired-idle.json")));

        assertThat(afterRestart.repository().findLatestCalibrationResult("M01").orElseThrow().result()).isEqualTo("PASS");
        assertThat(afterRestart.readinessService().getReadiness("M01").readyForSession())
                .as("Phase 1: current runtime readiness should be false after retained PAIRED_IDLE")
                .isFalse();
    }

    @Test
    void backendRestartWithReadyStatusRestoresCurrentReadiness_futureBehavior() throws Exception {
        ServiceFixture beforeRestart = newFixture();
        beforeRestart.subscriber().handleMessage("resq/M01/events/calibration", message(fixture("calibration-pass-4002.json")));

        ServiceFixture afterRestart = newFixture(beforeRestart.repository());
        afterRestart.subscriber().handleMessage("resq/M01/status", message(fixture("status-ready-for-session.json")));

        assertThat(afterRestart.repository().findLatestCalibrationResult("M01").orElseThrow().result()).isEqualTo("PASS");
        assertThat(afterRestart.readinessService().getReadiness("M01").readyForSession())
                .as("Phase 1: retained READY_FOR_SESSION should restore current readiness")
                .isTrue();
    }

    @Test
    void sessionStartMustWaitForFirmwareAck_futureBehavior() throws Exception {
        ServiceFixture fixture = newFixture();
        fixture.readinessService().handleCalibrationEvent("M01", calibrationPass("M01"));

        SessionStartResponse response = fixture.activeSessionService().startSession(new SessionStartRequest(
                "M01",
                "trainee-1",
                null,
                null,
                null,
                null,
                "adult-basic",
                "assessment",
                null
        ));

        assertThat(fixture.commandPublisher().publishedSessionStarts).hasSize(1);
        assertThat(response.active())
                .as("Phase 1: LocalHub should return/persist START_PENDING until firmware event 2000 ACK")
                .isFalse();
    }

    @Test
    void sessionStartNackClearsDeviceReservation_futureBehavior() throws Exception {
        ServiceFixture fixture = newFixture();
        fixture.readinessService().handleCalibrationEvent("M01", calibrationPass("M01"));
        SessionStartResponse response = fixture.activeSessionService().startSession(new SessionStartRequest(
                "M01",
                "trainee-1",
                null,
                null,
                null,
                null,
                "adult-basic",
                "assessment",
                null
        ));

        fixture.subscriber().handleMessage("resq/M01/events", message(fixture("session-start-nack.json")
                .replace("session-phase0-0002", response.sessionId())));

        assertThat(fixture.activeSessionService().findActiveSessionForDevice("M01"))
                .as("Phase 1: correlated firmware NACK should reject the pending session and clear the reservation")
                .isEmpty();
    }

    @Test
    void profileAndScenarioAreIndependent_futureBehavior() {
        CapturingMqttCommandPublisherService publisher = new CapturingMqttCommandPublisherService(newRepository());

        publisher.publishSessionStart(new SessionStartCommandPayload(
                "session-phase0-0001",
                "M01",
                "trainee-1",
                Instant.now(),
                "adult-basic",
                "assessment",
                null
        ));

        assertThat(publisher.lastPayload).containsEntry("session_id", "session-phase0-0001");
        assertThat(publisher.lastPayload).containsEntry("profile_id", "adult-basic");
        assertThat(publisher.lastPayload)
                .as("Phase 3: SessionStartCommandPayload must carry profileId separately; scenario must not become MQTT profile_id")
                .doesNotContainEntry("profile_id", "assessment");
    }

    @Test
    void deviceStatesRemainIsolated_currentBehavior() throws Exception {
        ServiceFixture fixture = newFixture();

        fixture.subscriber().handleMessage("resq/M01/events/calibration", message(fixture("calibration-pass-4002.json")));
        fixture.subscriber().handleMessage("resq/M02/status", message(fixture("status-paired-idle.json")));

        assertThat(fixture.readinessService().getReadiness("M01").readyForSession()).isTrue();
        assertThat(fixture.readinessService().getReadiness("M02").readyForSession()).isFalse();
        assertThat(fixture.registry().getLiveSummary("M01").orElseThrow().readyForSession()).isTrue();
        assertThat(fixture.registry().getLiveSummary("M02").orElseThrow().state()).isEqualTo("PAIRED_IDLE");
    }

    private ServiceFixture newFixture() throws Exception {
        return newFixture(newRepository());
    }

    private ServiceFixture newFixture(FirmwarePersistenceRepository repository) throws Exception {
        ManikinRegistryService registry = new ManikinRegistryService(12);
        registry.updateFromStatus("M01", objectMapper.readTree("""
                {"state":"PAIRED_IDLE","session_active":false,"calibrated":false,"ts_ms":1}
                """));
        DeviceReadinessService readinessService = new DeviceReadinessService();
        CapturingLiveStreamService liveStreamService = new CapturingLiveStreamService();
        CapturingMqttCommandPublisherService commandPublisher = new CapturingMqttCommandPublisherService(repository);
        CalibrationProfileFingerprintService fingerprintService = new CalibrationProfileFingerprintService();
        CalibrationProfileRepository profileRepository = newProfileRepository();
        CalibrationProfileService profileService = new CalibrationProfileService(profileRepository, fingerprintService);
        ActiveSessionService activeSessionService = new ActiveSessionService(
                registry,
                commandPublisher,
                new InMemoryLocalSessionRepository(),
                liveStreamService,
                new TraineeRecordsRepository(),
                new AllowingFirmwareCalibrationService(repository, registry, commandPublisher, profileService, fingerprintService),
                new NoopSyncQueueService(),
                null,
                new RateEstimatorRegistry(),
                readinessService,
                profileService,
                fingerprintService
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
                "state-consistency-regression",
                null,
                null
        );

        return new ServiceFixture(subscriber, registry, activeSessionService, readinessService, commandPublisher, repository);
    }

    private String fixture(String name) throws Exception {
        try (var input = getClass().getResourceAsStream("/state-consistency/" + name)) {
            if (input == null) {
                throw new IllegalArgumentException("Missing fixture " + name);
            }
            return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private MqttMessage message(String json) {
        return new MqttMessage(json.getBytes(StandardCharsets.UTF_8));
    }

    private static CalibrationMqttEvent calibrationPass(String deviceId) {
        return new CalibrationMqttEvent(
                deviceId,
                4002,
                "req-200-phase0-0001",
                "ACK",
                11,
                "PASS",
                "00000",
                0,
                "READY_FOR_SESSION",
                124000L,
                Instant.now(),
                "adult-basic"
        );
    }

    private static FirmwarePersistenceRepository newRepository() {
        FirmwarePersistenceRepository repository = new FirmwarePersistenceRepository(
                Path.of("target", "state-consistency-" + UUID.randomUUID() + ".sqlite").toString()
        );
        repository.initialize();
        return repository;
    }

    private record ServiceFixture(
            MqttSubscriberService subscriber,
            ManikinRegistryService registry,
            ActiveSessionService activeSessionService,
            DeviceReadinessService readinessService,
            CapturingMqttCommandPublisherService commandPublisher,
            FirmwarePersistenceRepository repository
    ) {
    }

    private static final class CapturingMqttCommandPublisherService extends MqttCommandPublisherService {
        private final List<SessionStartCommandPayload> publishedSessionStarts = new ArrayList<>();
        private Map<String, Object> lastPayload = Map.of();

        private CapturingMqttCommandPublisherService(FirmwarePersistenceRepository repository) {
            super(new ObjectMapper().findAndRegisterModules(), repository, "tcp://127.0.0.1:1", "state-consistency-regression");
        }

        @Override
        protected void ensureConnected() {
        }

        @Override
        protected FirmwareCommandPublishResult publishFirmwareCommand(
                String topic,
                Map<String, Object> payload,
                String action,
                FirmwareCommandTypeId commandTypeId
        ) {
            lastPayload = payload;
            return new FirmwareCommandPublishResult(topic, String.valueOf(payload.get("request_id")), payload);
        }

        @Override
        public void publishSessionStart(SessionStartCommandPayload payload) {
            publishedSessionStarts.add(payload);
            super.publishSessionStart(payload);
        }
    }

    private static final class AllowingFirmwareCalibrationService extends FirmwareCalibrationService {
        private AllowingFirmwareCalibrationService(
                FirmwarePersistenceRepository repository,
                ManikinRegistryService registry,
                MqttCommandPublisherService publisher,
                CalibrationProfileService profileService,
                CalibrationProfileFingerprintService fingerprintService
        ) {
            super(
                    publisher,
                    repository,
                    profileService,
                    registry,
                    fingerprintService
            );
        }

        @Override
        public Optional<String> sessionStartBlockReason(String deviceId) {
            return Optional.empty();
        }
    }

    private static CalibrationProfileRepository newProfileRepository() {
        CalibrationProfileRepository repository = new CalibrationProfileRepository(
                Path.of("target", "state-consistency-profiles-" + UUID.randomUUID() + ".sqlite").toString()
        );
        repository.initialize();
        return repository;
    }

    private static final class InMemoryLocalSessionRepository extends LocalSessionRepository {
        private InMemoryLocalSessionRepository() {
            super(Path.of("target", "state-consistency-sessions-" + UUID.randomUUID() + ".sqlite").toString());
        }

        @Override
        public synchronized void save(SessionEndResponse session) {
        }

        @Override
        public synchronized Optional<SessionEndResponse> findById(String sessionId) {
            return Optional.empty();
        }

        @Override
        public synchronized List<SessionEndResponse> findAll() {
            return List.of();
        }
    }

    private static final class NoopSyncQueueService extends SyncQueueService {
        private NoopSyncQueueService() {
            super(
                    new SyncQueueRepository(Path.of("target", "state-consistency-sync-" + UUID.randomUUID() + ".sqlite").toString()),
                    new ObjectMapper().findAndRegisterModules(),
                    new CloudSessionSummaryPayloadMapper()
            );
        }

        @Override
        public void enqueueSessionSummary(SessionEndResponse session) {
        }
    }

    private static final class CapturingCalibrationStreamService extends CalibrationStreamService {
        private final List<CalibrationStreamEvent> events = new ArrayList<>();

        private CapturingCalibrationStreamService(DeviceReadinessService readinessService) {
            super(readinessService);
        }

        @Override
        public void publishCalibrationUpdate(String deviceId, CalibrationMqttEvent event, DeviceReadinessState readiness) {
            events.add(CalibrationStreamEvent.update(deviceId, event, readiness));
        }
    }

    private static class CapturingLiveStreamService extends LiveStreamService {
        @Override
        public void publishInstructorLive(List<ManikinLiveSummary> payload) {
        }
    }
}
