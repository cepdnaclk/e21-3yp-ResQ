package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import lk.resq.localhub.model.DurableSessionRuntimeRecord;
import lk.resq.localhub.model.SessionLifecycleState;
import lk.resq.localhub.model.SessionRecoveryStatus;
import lk.resq.localhub.model.SessionStartCommandPayload;
import lk.resq.localhub.model.SessionStopCommandPayload;
import lk.resq.localhub.model.firmware.FirmwareCommandRequestRecord;
import lk.resq.localhub.model.firmware.FirmwareCommandTypeId;
import org.junit.jupiter.api.Test;

import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class SessionRestartRecoveryTest {

    private final ObjectMapper objectMapper = new ObjectMapper().registerModule(new JavaTimeModule());

    @Test
    void recoversStartPendingFromPersistedAck() throws Exception {
        Fixture fixture = newFixture();
        Instant now = fixture.clock.instant();
        seedRuntime(fixture.runtimeRepository, "session-start", "M01", SessionLifecycleState.START_PENDING, true,
                "req-300-a4f18d2c-000001", null, now);
        seedCommand(fixture.firmwareRepository, "req-300-a4f18d2c-000001", "M01", FirmwareCommandTypeId.SESSION_START.value(),
                "ACK", 2000, now);

        fixture.service.recoverDurableSessions();

        var recovered = fixture.service.findSessionStart("session-start").orElseThrow();
        assertThat(recovered.state()).isEqualTo(SessionLifecycleState.ACTIVE);
        assertThat(recovered.recoveryStatus()).isEqualTo(SessionRecoveryStatus.CONFIRMED);
        assertThat(fixture.service.findActiveSessionForDevice("M01")).isPresent();
    }

    @Test
    void recoversActiveFromRetainedMatchingSessionAndPreservesTelemetrySequence() throws Exception {
        Fixture fixture = newFixture();
        Instant now = fixture.clock.instant();
        seedRuntime(fixture.runtimeRepository, "session-active", "M01", SessionLifecycleState.ACTIVE, true,
                "req-300-a4f18d2c-000002", null, now, 5L,
                "{\"sampleCount\":1,\"totalCompressions\":1,\"validCompressions\":1,\"depthSampleCount\":1,\"depthProgressSampleCount\":0,\"rateSampleCount\":1,\"depthSumMm\":52.0,\"depthProgressSum\":0.0,\"rateSumCpm\":110.0,\"recoilTrueCount\":1,\"recoilFalseCount\":0,\"pausesCount\":0,\"lastDepthMm\":52.0,\"lastDepthProgress\":null,\"lastRateCpm\":110.0,\"lastRecoilOk\":true,\"lastPauseS\":0.2,\"latestFlags\":\"DEPTH_OK\"}");

        fixture.service.recoverDurableSessions();
        fixture.readinessService.handleStatus("M01", objectMapper.readTree("""
                {"state":"SESSION_ACTIVE","session_id":"session-active","sessionActive":true,"calibrated":true}
                """));
        fixture.service.reconcileDeviceRuntimeState("M01");

        assertThat(fixture.service.getSessionLiveView("session-active").orElseThrow().recoveryStatus())
                .isEqualTo("CONFIRMED");
        assertThat(fixture.service.validateTelemetryBinding("M01", telemetry("session-active", 5)).accepted()).isFalse();
        assertThat(fixture.service.validateTelemetryBinding("M01", telemetry("session-active", 6)).accepted()).isTrue();
    }

    @Test
    void activeWithReadyFirmwareBecomesInterruptedNotCompleted() throws Exception {
        Fixture fixture = newFixture();
        Instant now = fixture.clock.instant();
        seedRuntime(fixture.runtimeRepository, "session-lost", "M01", SessionLifecycleState.ACTIVE, true,
                "req-300-a4f18d2c-000003", null, now);

        fixture.service.recoverDurableSessions();
        fixture.readinessService.handleStatus("M01", objectMapper.readTree("""
                {"state":"READY_FOR_SESSION","session_id":null,"sessionActive":false,"calibrated":true}
                """));
        fixture.service.reconcileDeviceRuntimeState("M01");

        var recovered = fixture.service.findSessionStart("session-lost").orElseThrow();
        assertThat(recovered.state()).isEqualTo(SessionLifecycleState.INTERRUPTED);
        assertThat(fixture.service.findCompletedSession("session-lost")).isEmpty();
    }

    @Test
    void stopPendingWithPersistedStopAckCompletesOnceAcrossDuplicateRecovery() throws Exception {
        Fixture fixture = newFixture();
        Instant now = fixture.clock.instant();
        seedRuntime(fixture.runtimeRepository, "session-stop", "M01", SessionLifecycleState.STOP_PENDING, true,
                "req-300-a4f18d2c-000004", "req-301-a4f18d2c-000005", now);
        seedCommand(fixture.firmwareRepository, "req-301-a4f18d2c-000005", "M01", FirmwareCommandTypeId.SESSION_STOP.value(),
                "FINAL", 2001, now);

        fixture.service.recoverDurableSessions();
        fixture.service.recoverDurableSessions();

        assertThat(fixture.localSessionRepository.findById("session-stop")).isPresent();
        assertThat(fixture.localSessionRepository.saveCount).isEqualTo(1);
        assertThat(fixture.syncQueueRepository.findByEntity(lk.resq.localhub.model.SyncEntityType.SESSION_SUMMARY, "session-stop")).isPresent();
    }

    @Test
    void corruptAccumulatorSnapshotDoesNotBlockOtherRecoveredSessions() throws Exception {
        Fixture fixture = newFixture();
        Instant now = fixture.clock.instant();
        seedRuntime(fixture.runtimeRepository, "bad-json", "M01", SessionLifecycleState.ACTIVE, true,
                "req-300-a4f18d2c-000006", null, now, 2L, "{not-json");
        seedRuntime(fixture.runtimeRepository, "good-json", "M02", SessionLifecycleState.ACTIVE, true,
                "req-300-a4f18d2c-000007", null, now);

        fixture.service.recoverDurableSessions();

        assertThat(fixture.service.findSessionStart("bad-json")).isPresent();
        assertThat(fixture.service.findSessionStart("good-json")).isPresent();
    }

    private Fixture newFixture() throws Exception {
        String id = UUID.randomUUID().toString();
        MutableClock clock = new MutableClock(Instant.parse("2026-07-13T12:00:00Z"));
        SessionRuntimeRepository runtimeRepository = new SessionRuntimeRepository(Path.of("target", "session-recovery-runtime-" + id + ".sqlite").toString());
        runtimeRepository.initialize();
        FirmwarePersistenceRepository firmwareRepository = new FirmwarePersistenceRepository(Path.of("target", "session-recovery-firmware-" + id + ".sqlite").toString());
        firmwareRepository.initialize();
        CountingLocalSessionRepository localSessionRepository = new CountingLocalSessionRepository();
        SyncQueueRepository syncQueueRepository = new SyncQueueRepository(Path.of("target", "session-recovery-sync-" + id + ".sqlite").toString());
        syncQueueRepository.initialize();
        SyncQueueService syncQueueService = new SyncQueueService(syncQueueRepository, objectMapper, new CloudSessionSummaryPayloadMapper());
        NoopMqttCommandPublisherService publisher = new NoopMqttCommandPublisherService(firmwareRepository);
        ManikinRegistryService registry = new ManikinRegistryService(12);
        CalibrationProfileRepository profileRepository = new CalibrationProfileRepository(Path.of("target", "session-recovery-profile-" + id + ".sqlite").toString());
        profileRepository.initialize();
        CalibrationProfileFingerprintService fingerprintService = new CalibrationProfileFingerprintService();
        CalibrationProfileService profileService = new CalibrationProfileService(profileRepository, fingerprintService);
        FirmwareCalibrationService calibrationService = new FirmwareCalibrationService(
                publisher,
                firmwareRepository,
                profileService,
                registry,
                fingerprintService
        );
        TestIdentityValidator identityValidator = new TestIdentityValidator();
        DeviceReadinessService readinessService = new DeviceReadinessService(new DeviceRuntimeStateService(), identityValidator);
        ActiveSessionService service = new ActiveSessionService(
                registry,
                publisher,
                localSessionRepository,
                new NoopLiveStreamService(),
                new TraineeRecordsRepository(),
                calibrationService,
                syncQueueService,
                null,
                new RateEstimatorRegistry(),
                readinessService,
                7000L,
                7000L,
                clock,
                new CommandRequestIdGenerator(),
                runtimeRepository,
                firmwareRepository,
                objectMapper,
                1000L,
                1000L,
                25,
                profileService,
                fingerprintService,
                identityValidator
        );
        return new Fixture(service, runtimeRepository, firmwareRepository, localSessionRepository, syncQueueRepository, readinessService, clock);
    }

    private static void seedRuntime(
            SessionRuntimeRepository repository,
            String sessionId,
            String deviceId,
            SessionLifecycleState state,
            boolean active,
            String startRequestId,
            String stopRequestId,
            Instant now
    ) {
        seedRuntime(repository, sessionId, deviceId, state, active, startRequestId, stopRequestId, now, null, "{}");
    }

    private static void seedRuntime(
            SessionRuntimeRepository repository,
            String sessionId,
            String deviceId,
            SessionLifecycleState state,
            boolean active,
            String startRequestId,
            String stopRequestId,
            Instant now,
            Long lastSeq,
            String snapshotJson
    ) {
        repository.upsert(new DurableSessionRuntimeRecord(
                sessionId,
                deviceId,
                "trainee-1",
                "adult-basic",
                "assessment",
                null,
                null,
                null,
                state,
                active,
                now.minusSeconds(30),
                now,
                null,
                startRequestId,
                now.minusSeconds(30),
                now.plusSeconds(30),
                stopRequestId,
                stopRequestId == null ? null : now.minusSeconds(1),
                stopRequestId == null ? null : now.plusSeconds(30),
                null,
                null,
                null,
                lastSeq,
                snapshotJson,
                false,
                false,
                SessionRecoveryStatus.NONE,
                null,
                null,
                null
        ));
    }

    private static void seedCommand(
            FirmwarePersistenceRepository repository,
            String requestId,
            String deviceId,
            int commandType,
            String status,
            int replyEventId,
            Instant now
    ) {
        repository.recordCommandRequest(new FirmwareCommandRequestRecord(
                requestId,
                deviceId,
                commandType,
                commandType == FirmwareCommandTypeId.SESSION_START.value() ? "SESSION_START" : "SESSION_STOP",
                "resq/" + deviceId + "/cmd",
                "{}",
                status,
                requestId,
                replyEventId,
                "ACK",
                "{}",
                null,
                null,
                now.minusSeconds(10),
                now.minusSeconds(9),
                now.minusSeconds(1),
                null,
                now
        ));
    }

    private JsonNode telemetry(String sessionId, long seq) throws Exception {
        return objectMapper.readTree("""
                {"deviceId":"M01","sessionId":"%s","seq":%d,"eventType":"session_telemetry","state":"SESSION_ACTIVE","depthMm":52.0,"rateCpm":110.0,"recoilOk":true}
                """.formatted(sessionId, seq));
    }

    private record Fixture(
            ActiveSessionService service,
            SessionRuntimeRepository runtimeRepository,
            FirmwarePersistenceRepository firmwareRepository,
            CountingLocalSessionRepository localSessionRepository,
            SyncQueueRepository syncQueueRepository,
            DeviceReadinessService readinessService,
            MutableClock clock
    ) {
    }

    private static final class NoopMqttCommandPublisherService extends MqttCommandPublisherService {
        private NoopMqttCommandPublisherService(FirmwarePersistenceRepository repository) {
            super(new ObjectMapper(), repository, "tcp://127.0.0.1:1", "test", null, null, new CommandRequestIdGenerator(), MqttQosPolicy.defaults());
        }

        @Override
        public void publishSessionStart(SessionStartCommandPayload payload) {
        }

        @Override
        public void publishSessionStop(SessionStopCommandPayload payload) {
        }
    }

    private static final class NoopLiveStreamService extends LiveStreamService {
        @Override
        public void publishSessionLive(String sessionId, lk.resq.localhub.model.SessionLiveView payload) {
        }
    }

    private static final class CountingLocalSessionRepository extends LocalSessionRepository {
        private SessionEndResponseHolder holder;
        private int saveCount;

        private CountingLocalSessionRepository() {
            super("target/session-recovery-counting.sqlite");
        }

        @Override
        public synchronized void save(lk.resq.localhub.model.SessionEndResponse session) {
            holder = new SessionEndResponseHolder(session);
            saveCount++;
        }

        @Override
        public synchronized Optional<lk.resq.localhub.model.SessionEndResponse> findById(String sessionId) {
            return holder != null && holder.session.sessionId().equals(sessionId) ? Optional.of(holder.session) : Optional.empty();
        }

        @Override
        public synchronized List<lk.resq.localhub.model.SessionEndResponse> findAll() {
            return holder == null ? List.of() : List.of(holder.session);
        }
    }

    private record SessionEndResponseHolder(lk.resq.localhub.model.SessionEndResponse session) {
    }

    private static final class MutableClock extends Clock {
        private Instant instant;

        private MutableClock(Instant instant) {
            this.instant = instant;
        }

        @Override
        public ZoneId getZone() {
            return ZoneId.of("UTC");
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return instant;
        }
    }
}
