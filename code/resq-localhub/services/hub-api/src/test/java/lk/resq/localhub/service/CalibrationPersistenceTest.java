package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lk.resq.localhub.model.firmware.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class CalibrationPersistenceTest {

    private CalibrationPersistenceRepository repository;
    private DeviceReadinessService readinessService;
    private CapturingStreamService streamService;

    @BeforeEach
    void setUp() {
        String dbPath = Path.of("target", "calibration-persistence-test-" + UUID.randomUUID() + ".sqlite").toString();
        repository = new CalibrationPersistenceRepository(dbPath);
        repository.initialize();

        readinessService = new DeviceReadinessService();
        streamService = new CapturingStreamService(readinessService);
    }

    // -----------------------------------------------------------------------
    // Basic CRUD
    // -----------------------------------------------------------------------

    @Test
    void canSaveAndRetrieveEvidenceAndEventLogs() {
        CalibrationEvidence evidence = new CalibrationEvidence(
                null,
                "DEV-101",
                "req-1",
                Instant.now(),
                null,
                "RUNNING",
                "STARTING",
                false,
                1,
                "00000",
                0,
                "STARTING",
                "profile-1",
                20,
                2000,
                15000,
                15000,
                100,
                5000,
                "admin",
                Instant.now(),
                Instant.now()
        );

        repository.saveEvidence(evidence);

        Optional<CalibrationEvidence> latest = repository.findLatestEvidence("DEV-101");
        assertThat(latest).isPresent();
        assertThat(latest.get().deviceId()).isEqualTo("DEV-101");
        assertThat(latest.get().requestId()).isEqualTo("req-1");
        assertThat(latest.get().finalResult()).isEqualTo("RUNNING");
        assertThat(latest.get().createdByUsername()).isEqualTo("admin");

        CalibrationEventLog log = new CalibrationEventLog(
                null,
                "DEV-101",
                "req-1",
                4001,
                5,
                "RUNNING",
                "STEP_IN_PROGRESS",
                "00000",
                0,
                "CALIBRATING",
                12345L,
                Instant.now(),
                "{\"foo\":\"bar\"}"
        );
        repository.saveEventLog(log);

        List<CalibrationEventLog> logs = repository.findEventLogsForRequest("DEV-101", "req-1");
        assertThat(logs).hasSize(1);
        assertThat(logs.get(0).progressId()).isEqualTo(5);
        assertThat(logs.get(0).rawPayloadJson()).isEqualTo("{\"foo\":\"bar\"}");
    }

    @Test
    void historyLimitDefaultsAreRespected() {
        for (int i = 0; i < 25; i++) {
            repository.saveEvidence(new CalibrationEvidence(
                    null, "DEV-HIST", "req-" + i, Instant.now(), null, "RUNNING", "CALIBRATING",
                    false, null, null, null, null, null, 20, 2000, 15000, 15000, 20, 3000, "admin",
                    Instant.now(), Instant.now()
            ));
        }
        List<CalibrationEvidence> history20 = repository.findEvidenceHistory("DEV-HIST", 20);
        assertThat(history20).hasSize(20);

        List<CalibrationEvidence> history5 = repository.findEvidenceHistory("DEV-HIST", 5);
        assertThat(history5).hasSize(5);
    }

    // -----------------------------------------------------------------------
    // Bound rawPayloadJson
    // -----------------------------------------------------------------------

    @Test
    void rawPayloadJsonIsBoundedToMaxChars() {
        // MAX_RAW_PAYLOAD_CHARS = 4096; send 5000 chars
        String oversizedPayload = "x".repeat(5000);
        CalibrationEventLog log = new CalibrationEventLog(
                null, "DEV-BOUND", "req-bound", 4001, 1, null, null, null, null, null, 0L,
                Instant.now(), oversizedPayload
        );
        repository.saveEventLog(log);

        List<CalibrationEventLog> logs = repository.findEventLogsForRequest("DEV-BOUND", "req-bound");
        assertThat(logs).hasSize(1);
        assertThat(logs.get(0).rawPayloadJson()).hasSize(4096);
    }

    // -----------------------------------------------------------------------
    // Cancel → CANCEL_REQUESTED (non-terminal)
    // -----------------------------------------------------------------------

    /**
     * Refinement #1: Cancel sets calibrationState=CANCEL_REQUESTED but finalResult stays RUNNING
     * (non-terminal) — firmware terminal confirmation changes finalResult later.
     */
    @Test
    void cancelCalibrationSetsCancelRequestedNotCancelled() {
        CalibrationEvidence runningEvidence = new CalibrationEvidence(
                null, "DEV-CAN", "req-run", Instant.now(), null, "RUNNING", "CALIBRATING",
                false, 5, null, null, "CALIBRATING", "profile", 20, 2000, 15000, 15000, 20, 3000,
                "admin", Instant.now(), Instant.now()
        );
        repository.saveEvidence(runningEvidence);

        Optional<CalibrationEvidence> found = repository.findLatestRunningEvidence("DEV-CAN");
        assertThat(found).isPresent();

        CalibrationEvidence old = found.get();
        // Update calibrationState to CANCEL_REQUESTED but leave finalResult as RUNNING (non-terminal)
        CalibrationEvidence updated = new CalibrationEvidence(
                old.id(), old.deviceId(), old.requestId(), old.startedAt(),
                old.completedAt(), old.finalResult(),  // finalResult remains RUNNING
                "CANCEL_REQUESTED",                    // only calibrationState changes
                old.readyForSessionAtCompletion(), old.lastProgressId(), old.lastReasonId(),
                old.lastActionId(), old.firmwareState(), old.profileId(), old.hallDelta(),
                old.refPressure(), old.bladder1Pressure(), old.bladder2Pressure(),
                old.sampleIntervalMs(), old.calibrationWindowMs(), old.createdByUsername(),
                old.createdAt(), Instant.now()
        );
        repository.updateEvidence(updated);

        Optional<CalibrationEvidence> after = repository.findLatestEvidence("DEV-CAN");
        assertThat(after).isPresent();
        assertThat(after.get().finalResult()).isEqualTo("RUNNING");      // not CANCELLED
        assertThat(after.get().calibrationState()).isEqualTo("CANCEL_REQUESTED");

        // Still findable as "running" since finalResult is non-terminal
        assertThat(repository.findLatestRunningEvidence("DEV-CAN")).isPresent();
    }

    // -----------------------------------------------------------------------
    // Persistence failure isolation (Refinement #6 & #7)
    // -----------------------------------------------------------------------

    /**
     * Refinement #6a: saveEventLog failure does NOT break live readiness update or SSE broadcast.
     * The persistence try-catch in MqttSubscriberService is after live/SSE updates.
     */
    @Test
    void saveEventLogFailureDoesNotBreakLiveReadinessOrSseBroadcast() {
        CalibrationPersistenceRepository failingRepo = new CalibrationPersistenceRepository(
                Path.of("target", "failing-eventlog-" + UUID.randomUUID() + ".sqlite").toString()
        ) {
            @Override
            public void saveEventLog(CalibrationEventLog log) {
                throw new RuntimeException("DB offline: saveEventLog");
            }

            @Override
            public Optional<CalibrationEvidence> findLatestRunningEvidence(String deviceId) {
                return Optional.empty(); // avoid second DB hit
            }

            @Override
            public Optional<CalibrationEvidence> findEvidenceByRequestId(String deviceId, String requestId) {
                return Optional.empty();
            }

            @Override
            public void updateEvidence(CalibrationEvidence evidence) {
                throw new RuntimeException("DB offline: updateEvidence");
            }
        };

        MqttSubscriberService sub = buildSubscriberWithRepo(failingRepo);

        ObjectNode payload = new ObjectMapper().createObjectNode();
        payload.put("eventId", 4001);
        payload.put("progressId", 2);
        payload.put("firmwareState", "CALIBRATING");
        payload.put("tsMs", 1000L);

        sub.handleMessage(
                "resq/manikins/DEV-101/events/calibration",
                new org.eclipse.paho.client.mqttv3.MqttMessage(payload.toString().getBytes())
        );

        // Live readiness MUST be updated despite DB failure
        DeviceReadinessState state = readinessService.getReadiness("DEV-101");
        assertThat(state.calibrationState()).isEqualTo(CalibrationState.CALIBRATING);
        assertThat(state.currentProgressId()).isEqualTo(2);

        // SSE broadcast MUST happen despite DB failure
        assertThat(streamService.lastPublishedDeviceId).isEqualTo("DEV-101");
        assertThat(streamService.lastReadiness.calibrationState()).isEqualTo(CalibrationState.CALIBRATING);
    }

    /**
     * Refinement #6b: updateEvidence failure on a final PASS event does NOT break
     * live readiness or SSE broadcast.
     */
    @Test
    void updateEvidenceFailureOnFinalPassDoesNotBreakLiveReadinessOrSseBroadcast() {
        CalibrationPersistenceRepository failingRepo = new CalibrationPersistenceRepository(
                Path.of("target", "failing-updateevid-" + UUID.randomUUID() + ".sqlite").toString()
        ) {
            @Override
            public void saveEventLog(CalibrationEventLog log) {
                throw new RuntimeException("DB offline: saveEventLog on PASS");
            }

            @Override
            public Optional<CalibrationEvidence> findLatestRunningEvidence(String deviceId) {
                return Optional.empty();
            }

            @Override
            public Optional<CalibrationEvidence> findEvidenceByRequestId(String deviceId, String requestId) {
                return Optional.empty();
            }

            @Override
            public void updateEvidence(CalibrationEvidence evidence) {
                throw new RuntimeException("DB offline: updateEvidence on PASS");
            }
        };

        MqttSubscriberService sub = buildSubscriberWithRepo(failingRepo);

        ObjectNode payload = new ObjectMapper().createObjectNode();
        payload.put("eventId", 4002);
        payload.put("result", "PASS");
        payload.put("firmwareState", "READY_FOR_SESSION");
        payload.put("tsMs", 2000L);

        sub.handleMessage(
                "resq/manikins/DEV-101/events/calibration",
                new org.eclipse.paho.client.mqttv3.MqttMessage(payload.toString().getBytes())
        );

        // Live readiness MUST reflect PASS even though DB failed
        DeviceReadinessState state = readinessService.getReadiness("DEV-101");
        assertThat(state.readyForSession()).isTrue();

        // SSE MUST broadcast the final PASS result
        assertThat(streamService.lastPublishedDeviceId).isEqualTo("DEV-101");
        assertThat(streamService.lastReadiness.readyForSession()).isTrue();
    }

    /**
     * Refinement #7: evidence save failure after successful MQTT publish still returns PUBLISHED.
     */
    @Test
    void startCalibrationSaveFailureStillReturnsPublished() {
        CalibrationPersistenceRepository failingRepo = new CalibrationPersistenceRepository(
                Path.of("target", "failing-saveevid-" + UUID.randomUUID() + ".sqlite").toString()
        ) {
            @Override
            public void saveEvidence(CalibrationEvidence evidence) {
                throw new RuntimeException("DB offline: saveEvidence");
            }
        };

        DummyPublisher publisher = new DummyPublisher(new ObjectMapper(), null);
        ManikinRegistryService registry = new ManikinRegistryService(12);
        ObjectNode statusPayload = new ObjectMapper().createObjectNode();
        statusPayload.put("state", "paired_idle");
        registry.updateFromStatus("DEV-101", statusPayload);

        CalibrationCommandService service = new CalibrationCommandService(
                publisher,
                readinessService,
                registry,
                new FirmwareRequestIdGenerator(),
                streamService,
                failingRepo
        );

        CalibrationStartRequest request = new CalibrationStartRequest(13500, 20100, 15000, 15000, "adult", 20, 3000);
        CalibrationCommandResponse response = service.startCalibration("DEV-101", request, "instructor1");

        // MQTT publish succeeded → response MUST be PUBLISHED despite DB save failure
        assertThat(response.status()).isEqualTo("PUBLISHED");
        assertThat(response.deviceId()).isEqualTo("DEV-101");
        assertThat(publisher.lastPublishedDeviceId).isEqualTo("DEV-101");

        // Live readiness MUST still transition to STARTING
        DeviceReadinessState state = readinessService.getReadiness("DEV-101");
        assertThat(state.calibrationState()).isEqualTo(CalibrationState.STARTING);
    }

    // -----------------------------------------------------------------------
    // Backend restart safety (Refinement #10)
    // -----------------------------------------------------------------------

    /**
     * Refinement #10: After backend restart, persisted PASS history is visible,
     * but session start is blocked because in-memory DeviceReadinessService starts UNKNOWN.
     */
    @Test
    void backendRestartKeepsHistoryButSessionBlockedUntilLiveConfirm() {
        // 1. Save a PASS evidence record (simulating a previous run)
        CalibrationEvidence completedEvidence = new CalibrationEvidence(
                null, "DEV-101", "req-pass", Instant.now(), Instant.now(),
                "PASS", "READY_FOR_SESSION", true, 11, "00000", 0, "READY_FOR_SESSION",
                "default", 20, 2000, 15000, 15000, 100, 5000, "admin", Instant.now(), Instant.now()
        );
        repository.saveEvidence(completedEvidence);

        // 2. Simulate restart: fresh in-memory DeviceReadinessService (starts UNKNOWN)
        DeviceReadinessService cleanReadinessService = new DeviceReadinessService();

        // 3. History IS visible in DB
        Optional<CalibrationEvidence> dbEvidence = repository.findLatestEvidence("DEV-101");
        assertThat(dbEvidence).isPresent();
        assertThat(dbEvidence.get().finalResult()).isEqualTo("PASS");
        assertThat(dbEvidence.get().readyForSessionAtCompletion()).isTrue();

        // 4. But live readiness MUST block session start — starts from UNKNOWN
        DeviceReadinessState liveState = cleanReadinessService.getReadiness("DEV-101");
        assertThat(liveState.readyForSession()).isFalse();
        assertThat(liveState.calibrationState()).isEqualTo(CalibrationState.UNKNOWN);
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private MqttSubscriberService buildSubscriberWithRepo(CalibrationPersistenceRepository repo) {
        return new MqttSubscriberService(
                new ObjectMapper(),
                new ManikinRegistryService(12),
                null,
                null,
                new FirmwarePersistenceRepository(
                        Path.of("target", "firmware-temp-" + UUID.randomUUID() + ".sqlite").toString()
                ),
                new RateEstimatorRegistry(),
                readinessService,
                streamService,
                repo,
                "tcp://127.0.0.1:1",
                "test-client",
                null,
                null
        );
    }

    private static class CapturingStreamService extends CalibrationStreamService {
        private String lastPublishedDeviceId;
        private DeviceReadinessState lastReadiness;

        private CapturingStreamService(DeviceReadinessService readinessService) {
            super(readinessService);
        }

        @Override
        public void publishReadinessSnapshot(String deviceId, DeviceReadinessState readiness) {
            this.lastPublishedDeviceId = deviceId;
            this.lastReadiness = readiness;
        }

        @Override
        public void publishCalibrationUpdate(String deviceId, CalibrationMqttEvent event, DeviceReadinessState readiness) {
            this.lastPublishedDeviceId = deviceId;
            this.lastReadiness = readiness;
        }
    }

    private static class DummyPublisher extends MqttCommandPublisherService {
        private String lastPublishedDeviceId;

        private DummyPublisher(ObjectMapper objectMapper, FirmwarePersistenceRepository repository) {
            super(objectMapper, repository, "tcp://127.0.0.1:1", "test");
        }

        @Override
        protected void ensureConnected() {}

        @Override
        protected void publishToBroker(String topic, String jsonPayload) {}

        @Override
        public FirmwareCommandPublishResult publishCalibrationStart(String deviceId, String requestId,
                                                                    CalibrationStartRequest request) {
            this.lastPublishedDeviceId = deviceId;
            return new FirmwareCommandPublishResult("topic", requestId, java.util.Map.of());
        }
    }
}
