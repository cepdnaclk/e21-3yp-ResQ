package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.localhub.model.SessionEndRequest;
import lk.resq.localhub.model.SessionEndResponse;
import lk.resq.localhub.model.SessionStartRequest;
import lk.resq.localhub.model.SessionStartResponse;
import lk.resq.localhub.model.SessionStartCommandPayload;
import lk.resq.localhub.model.SessionStopCommandPayload;
import lk.resq.localhub.model.firmware.FirmwareCalibrationResultRecord;
import lk.resq.localhub.service.CalibrationProfileRepository;
import lk.resq.localhub.service.CalibrationProfileService;
import lk.resq.localhub.service.SyncQueueRepository;
import lk.resq.localhub.service.SyncQueueService;
import org.junit.jupiter.api.Test;

import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ActiveSessionServiceTest {

    private final ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();

    @Test
    void validatesTelemetryAgainstActiveSessionAndDeviceBinding() throws Exception {
        ActiveSessionService service = newService();
        SessionStartResponse session = service.startSession(new SessionStartRequest(
                "M01",
                null,
                null,
                null,
                "Guest",
                "Validation smoke",
                null
        ));

        JsonNode valid = telemetry("M01", session.sessionId(), 1, 52, 110);
        ActiveSessionService.TelemetryValidationResult accepted = service.validateTelemetryBinding("M01", valid);
        assertThat(accepted.accepted()).isTrue();
        assertThat(accepted.sessionId()).isEqualTo(session.sessionId());
        assertThat(accepted.deviceId()).isEqualTo("M01");

        assertRejected(service.validateTelemetryBinding("M01", telemetry("M01", "S-WRONG", 1, 52, 110)), "session is not active");
        assertRejected(service.validateTelemetryBinding("M02", valid), "payload deviceId does not match MQTT topic deviceId");
        assertThat(service.validateTelemetryBinding("M01", telemetryWithoutSession("M01")).accepted()).isTrue();
        assertRejected(service.validateTelemetryBinding("M02", telemetryWithoutSession("M02")), "payload sessionId is missing");
        assertRejected(service.validateTelemetryBinding("M01", telemetry("M01", session.sessionId(), 2, -1, 110)), "depthMm is outside");
        assertRejected(service.validateTelemetryBinding("M01", objectMapper.readTree("""
                {
                  "deviceId": "M01",
                  "sessionId": "%s",
                  "compressionCount": 1
                }
                """.formatted(session.sessionId()))), "required metric-first fields");
    }

    @Test
    void acceptsNormalizedMetricFirstAndLegacyRawTelemetry() throws Exception {
        ActiveSessionService service = newService();
        SessionStartResponse session = service.startSession(new SessionStartRequest(
                "M01",
                null,
                null,
                null,
                "Guest",
                "Compatibility smoke",
                null
        ));

        JsonNode metricFirst = objectMapper.readTree("""
                {
                  "deviceId": "M01",
                  "sessionId": "%s",
                  "seq": 1,
                  "depthMm": 52,
                  "rateCpm": 110,
                  "recoilOk": true,
                  "pauseS": 0.2,
                  "compressionCount": 18,
                  "handPlacement": "CENTER",
                  "flags": ["DEPTH_OK", "RATE_OK"],
                  "debugRaw": {
                    "hallRaw": 3420,
                    "force1Raw": 120000
                  }
                }
                """.formatted(session.sessionId()));
        assertThat(service.validateTelemetryBinding("M01", metricFirst).accepted()).isTrue();
        service.recordTelemetry("M01", metricFirst);

        JsonNode legacyRaw = objectMapper.readTree("""
                {
                  "device_id": "M01",
                  "session_id": "%s",
                  "seq": 2,
                  "force1": 120000,
                  "force2": 118000,
                  "hall_raw": 3420,
                  "current_delta": 52,
                  "total_compressions": 18,
                  "feedback": "PERFECT"
                }
                """.formatted(session.sessionId()));
        assertThat(service.validateTelemetryBinding("M01", legacyRaw).accepted()).isTrue();
    }

    @Test
    void countsFirmwareTelemetryWithDepthProgressWithoutTreatingItAsMillimeters() throws Exception {
        ActiveSessionService service = newService();
        SessionStartResponse session = service.startSession(new SessionStartRequest(
                "M01",
                null,
                null,
                null,
                "Guest",
                "Depth progress smoke",
                null
        ));

        JsonNode firmwareTelemetry = objectMapper.readTree("""
                {
                  "session_id": "%s",
                  "depth_progress": 0.78,
                  "depth_ok": true,
                  "rate_cpm": 111,
                  "compression_count": 1,
                  "valid_compression_count": 1,
                  "recoil_ok_count": 1,
                  "incomplete_recoil_count": 0,
                  "pause_s": 0.2,
                  "flags": "DEPTH_OK,RATE_OK,RECOIL_OK"
                }
                """.formatted(session.sessionId()));

        assertThat(service.validateTelemetryBinding("M01", firmwareTelemetry).accepted()).isTrue();
        service.recordTelemetry("M01", firmwareTelemetry);

        var liveView = service.getSessionLiveView(session.sessionId()).orElseThrow();
        assertThat(liveView.latestDepthMm()).isNull();
        assertThat(liveView.latestRateCpm()).isEqualTo(111.0);
        assertThat(liveView.latestMetric()).isNotNull();
        assertThat(liveView.latestMetric().depthProgress()).isEqualTo(0.78);
        assertThat(liveView.latestMetric().depthOk()).isTrue();
        assertThat(liveView.latestMetric().compressionCount()).isEqualTo(1);

        SessionEndResponse completed = service.endSession(new SessionEndRequest(session.sessionId()));
        assertThat(completed.summary().sampleCount()).isEqualTo(1);
        assertThat(completed.summary().totalCompressions()).isEqualTo(1);
        assertThat(completed.summary().validCompressions()).isEqualTo(1);
        assertThat(completed.summary().avgDepthMm()).isEqualTo(0.0);
        assertThat(completed.summary().avgDepthProgress()).isEqualTo(0.78);
        assertThat(completed.summary().avgRateCpm()).isEqualTo(111.0);
        assertThat(completed.summary().recoilOkCount()).isEqualTo(1);
        assertThat(completed.summary().incompleteRecoilCount()).isEqualTo(0);
        assertThat(completed.summary().latestFlags()).isEqualTo("DEPTH_OK,RATE_OK,RECOIL_OK");
    }

    @Test
    void replacesSessionLiveMetricOnEveryAcceptedTelemetryUpdate() throws Exception {
        ActiveSessionService service = newService();
        SessionStartResponse session = service.startSession(new SessionStartRequest(
                "M01",
                null,
                null,
                null,
                "Guest",
                "Live update smoke",
                null
        ));

        service.recordTelemetry("M01", objectMapper.readTree("""
                {
                  "device_id": "M01",
                  "session_id": "%s",
                  "event_type": "session_telemetry",
                  "state": "SESSION_ACTIVE",
                  "ts_ms": 100,
                  "depth_progress": 0.2,
                  "rate_cpm": 102,
                  "compression_count": 10,
                  "pressure_balance_pct": 19.0
                }
                """.formatted(session.sessionId())));
        service.recordTelemetry("M01", objectMapper.readTree("""
                {
                  "device_id": "M01",
                  "session_id": "%s",
                  "event_type": "session_telemetry",
                  "state": "SESSION_ACTIVE",
                  "ts_ms": 200,
                  "depth_progress": 1.0,
                  "rate_cpm": 137,
                  "compression_count": 11,
                  "pressure_balance_pct": 73.5
                }
                """.formatted(session.sessionId())));

        var liveView = service.getSessionLiveView(session.sessionId()).orElseThrow();
        assertThat(liveView.latestMetric().tsMs()).isEqualTo(200L);
        assertThat(liveView.latestMetric().depthProgress()).isEqualTo(1.0);
        assertThat(liveView.latestMetric().rateCpm()).isEqualTo(137.0);
        assertThat(liveView.latestMetric().compressionCount()).isEqualTo(11);
        assertThat(liveView.latestMetric().pressureBalancePct()).isEqualTo(73.5);
        assertThat(liveView.pressureBalancePct()).isEqualTo(73.5);
    }

    @Test
    void countsDepthMillimetersAndDepthProgressIndependently() throws Exception {
        ActiveSessionService service = newService();
        SessionStartResponse session = service.startSession(new SessionStartRequest(
                "M01",
                null,
                null,
                null,
                "Guest",
                "Depth smoke",
                null
        ));

        JsonNode telemetry = objectMapper.readTree("""
                {
                  "session_id": "%s",
                  "depth_mm": 52.5,
                  "depth_progress": 0.81,
                  "rate_cpm": 108,
                  "compression_count": 3,
                  "recoil_ok": true,
                  "pause_s": 0.0,
                  "flags": "DEPTH_OK"
                }
                """.formatted(session.sessionId()));

        assertThat(service.validateTelemetryBinding("M01", telemetry).accepted()).isTrue();
        service.recordTelemetry("M01", telemetry);

        SessionEndResponse completed = service.endSession(new SessionEndRequest(session.sessionId()));
        assertThat(completed.summary().sampleCount()).isEqualTo(1);
        assertThat(completed.summary().totalCompressions()).isEqualTo(3);
        assertThat(completed.summary().validCompressions()).isEqualTo(3);
        assertThat(completed.summary().avgDepthMm()).isEqualTo(52.5);
        assertThat(completed.summary().avgDepthProgress()).isEqualTo(0.81);
        assertThat(completed.summary().avgRateCpm()).isEqualTo(108.0);
        assertThat(completed.summary().recoilOkCount()).isEqualTo(1);
        assertThat(completed.summary().incompleteRecoilCount()).isEqualTo(0);
    }

    @Test
    void rejectsEndedSessionAndNonIncreasingSeq() throws Exception {
        ActiveSessionService service = newService();
        SessionStartResponse session = service.startSession(new SessionStartRequest(
                "M01",
                null,
                null,
                null,
                "Guest",
                "Validation smoke",
                null
        ));

        JsonNode first = telemetry("M01", session.sessionId(), 1, 52, 110);
        service.recordTelemetry("M01", first);

        assertRejected(service.validateTelemetryBinding("M01", telemetry("M01", session.sessionId(), 1, 53, 111)), "seq is not newer");

        service.endSession(new SessionEndRequest(session.sessionId()));
        assertRejected(service.validateTelemetryBinding("M01", telemetry("M01", session.sessionId(), 2, 54, 112)), "session is not active");
    }

    @Test
    void blocksSessionStartForKnownNotReadyFirmwareDevice() throws Exception {
        ServiceFixture fixture = newServiceFixture();
        fixture.registry.updateFromStatus("M01", objectMapper.readTree("""
                {
                  "deviceId": "M01",
                  "state": "CALIBRATING",
                  "session_active": false,
                  "calibrated": false
                }
                """));

        assertThatThrownBy(() -> fixture.service.startSession(new SessionStartRequest(
                "M01",
                null,
                null,
                null,
                "Guest",
                "Blocked readiness",
                null
        ))).isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Readiness check is still running.");
    }

    @Test
    void allowsSessionStartWhenFirmwareIsReadyDespiteFailedCalibration() throws Exception {
        ServiceFixture fixture = newServiceFixture();
        fixture.repository.saveCalibrationResult(new FirmwareCalibrationResultRecord(
                0,
                "M01",
                null,
                null,
                null,
                4002,
                "FAIL",
                "COMPLETED",
                12,
                "12345",
                8,
                "CALIBRATION_FAIL",
                false,
                100L,
                Instant.now(),
                "{}"
        ));
        fixture.registry.updateFromStatus("M01", objectMapper.readTree("""
                {
                  "deviceId": "M01",
                  "state": "READY_FOR_SESSION",
                  "session_active": false,
                  "calibrated": false
                }
                """));

        SessionStartResponse session = fixture.service.startSession(new SessionStartRequest(
                "M01",
                null,
                null,
                null,
                "Guest",
                "Ready firmware",
                null
        ));

        assertThat(session.deviceId()).isEqualTo("M01");
        assertThat(session.active()).isTrue();
    }

    @Test
    void testSessionStartReadinessGating() throws Exception {
        // 1. Device live state READY_FOR_SESSION, no backend calibration record: start succeeds.
        {
            ServiceFixture fixture = newServiceFixture();
            fixture.registry.updateFromStatus("M01", objectMapper.readTree("""
                    {
                      "deviceId": "M01",
                      "state": "READY_FOR_SESSION",
                      "session_active": false,
                      "calibrated": false
                    }
                    """));
            SessionStartResponse session = fixture.service.startSession(new SessionStartRequest(
                    "M01", null, null, null, "Guest", "Ready", null
            ));
            assertThat(session.deviceId()).isEqualTo("M01");
            assertThat(session.active()).isTrue();
        }

        // 2. Device live state PAIRED_IDLE, no backend calibration record: start fails with friendly not-ready reason.
        {
            ServiceFixture fixture = newServiceFixture();
            fixture.registry.updateFromStatus("M01", objectMapper.readTree("""
                    {
                      "deviceId": "M01",
                      "state": "PAIRED_IDLE",
                      "session_active": false,
                      "calibrated": false
                    }
                    """));
            assertThatThrownBy(() -> fixture.service.startSession(new SessionStartRequest(
                    "M01", null, null, null, "Guest", "Ready", null
            ))).isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("Run readiness check or wait until firmware reports READY_FOR_SESSION.");
        }

        // 3. Device live state CALIBRATION_FAIL: start fails.
        {
            ServiceFixture fixture = newServiceFixture();
            fixture.registry.updateFromStatus("M01", objectMapper.readTree("""
                    {
                      "deviceId": "M01",
                      "state": "CALIBRATION_FAIL",
                      "session_active": false,
                      "calibrated": false
                    }
                    """));
            assertThatThrownBy(() -> fixture.service.startSession(new SessionStartRequest(
                    "M01", null, null, null, "Guest", "Ready", null
            ))).isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("Readiness check failed. Run setup again.");
        }

        // 4. Device live state CALIBRATING: start fails.
        {
            ServiceFixture fixture = newServiceFixture();
            fixture.registry.updateFromStatus("M01", objectMapper.readTree("""
                    {
                      "deviceId": "M01",
                      "state": "CALIBRATING",
                      "session_active": false,
                      "calibrated": false
                    }
                    """));
            assertThatThrownBy(() -> fixture.service.startSession(new SessionStartRequest(
                    "M01", null, null, null, "Guest", "Ready", null
            ))).isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("Readiness check is still running.");
        }

        // 5. Device live state ERROR: start fails.
        {
            ServiceFixture fixture = newServiceFixture();
            fixture.registry.updateFromStatus("M01", objectMapper.readTree("""
                    {
                      "deviceId": "M01",
                      "state": "ERROR",
                      "session_active": false,
                      "calibrated": false
                    }
                    """));
            assertThatThrownBy(() -> fixture.service.startSession(new SessionStartRequest(
                    "M01", null, null, null, "Guest", "Ready", null
            ))).isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("Manikin needs support before training.");
        }

        // 6. Device live state SESSION_ACTIVE: start fails.
        {
            ServiceFixture fixture = newServiceFixture();
            fixture.registry.updateFromStatus("M01", objectMapper.readTree("""
                    {
                      "deviceId": "M01",
                      "state": "SESSION_ACTIVE",
                      "session_active": false,
                      "calibrated": false
                    }
                    """));
            assertThatThrownBy(() -> fixture.service.startSession(new SessionStartRequest(
                    "M01", null, null, null, "Guest", "Ready", null
            ))).isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("This manikin is already in a session.");
        }

        // 7. Device live state stale/offline: start fails.
        {
            ServiceFixture fixture = newServiceFixture();
            // No registry update at all: summary is empty (offline)
            assertThatThrownBy(() -> fixture.service.startSession(new SessionStartRequest(
                    "M-OFFLINE", null, null, null, "Guest", "Ready", null
            ))).isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("Manikin is offline or stale.");
        }

        // 8. Backend readiness PASS, firmware state not available but device online: start succeeds.
        {
            ServiceFixture fixture = newServiceFixture();
            fixture.repository.saveCalibrationResult(new FirmwareCalibrationResultRecord(
                    0, "M01", "default", "req-1", "reply-1", 1, "PASS", "ACK", 1, "00000", 1, null, true, 100L, Instant.now(), "{}"
            ));
            fixture.registry.updateFromStatus("M01", objectMapper.readTree("""
                    {
                      "deviceId": "M01",
                      "state": null,
                      "session_active": false,
                      "calibrated": true
                    }
                    """));
            SessionStartResponse session = fixture.service.startSession(new SessionStartRequest(
                    "M01", null, null, null, "Guest", "Ready", null
            ));
            assertThat(session.deviceId()).isEqualTo("M01");
            assertThat(session.active()).isTrue();
        }
    }

    private ActiveSessionService newService() throws Exception {
        return newServiceFixture().service;
    }

    private ServiceFixture newServiceFixture() throws Exception {
        MqttCommandPublisherService commandPublisher = new NoopMqttCommandPublisherService();
        LocalSessionRepository sessionRepository = new InMemoryLocalSessionRepository();
        LiveStreamService liveStreamService = new NoopLiveStreamService();
        TraineeRecordsRepository traineeRecordsRepository = new TraineeRecordsRepository();
        ManikinRegistryService registry = new ManikinRegistryService(12);
        registry.updateFromStatus("M01", objectMapper.readTree("""
                {
                  "deviceId": "M01",
                  "state": "READY_FOR_SESSION",
                  "session_active": false,
                  "calibrated": true
                }
                """));
        FirmwarePersistenceRepository firmwareRepository = new FirmwarePersistenceRepository(
                Path.of("target", "active-session-firmware-test-" + UUID.randomUUID() + ".sqlite").toString()
        );
        firmwareRepository.initialize();
        CalibrationProfileRepository profileRepository = new CalibrationProfileRepository(
          Path.of("target", "active-session-profile-test-" + UUID.randomUUID() + ".sqlite").toString()
        );
        profileRepository.initialize();
        CalibrationProfileService profileService = new CalibrationProfileService(profileRepository);
        FirmwareCalibrationService firmwareCalibrationService = new FirmwareCalibrationService(
                commandPublisher,
                firmwareRepository,
          profileService,
                registry
        );
        SyncQueueRepository syncQueueRepository = new SyncQueueRepository(
          Path.of("target", "active-session-sync-test-" + UUID.randomUUID() + ".sqlite").toString()
        );
        syncQueueRepository.initialize();
        SyncQueueService syncQueueService = new SyncQueueService(
                syncQueueRepository,
                objectMapper,
                new CloudSessionSummaryPayloadMapper()
        );
        ActiveSessionService service = new ActiveSessionService(
                registry,
                commandPublisher,
                sessionRepository,
                liveStreamService,
                traineeRecordsRepository,
          firmwareCalibrationService,
          syncQueueService
        );
        return new ServiceFixture(service, registry, firmwareRepository);
    }

    private JsonNode telemetry(String deviceId, String sessionId, long seq, double depthMm, double rateCpm) throws Exception {
        return objectMapper.readTree("""
                {
                  "deviceId": "%s",
                  "sessionId": "%s",
                  "seq": %d,
                  "depthMm": %.1f,
                  "rateCpm": %.1f,
                  "recoilOk": true,
                  "pauseS": 0.2,
                  "compressionCount": 1,
                  "handPlacement": "CENTER",
                  "flags": ["DEPTH_OK"]
                }
                """.formatted(deviceId, sessionId, seq, depthMm, rateCpm));
    }

    private JsonNode telemetryWithoutSession(String deviceId) throws Exception {
        return objectMapper.readTree("""
                {
                  "deviceId": "%s",
                  "seq": 1,
                  "depthMm": 52,
                  "rateCpm": 110
                }
                """.formatted(deviceId));
    }

    private void assertRejected(ActiveSessionService.TelemetryValidationResult result, String reasonFragment) {
        assertThat(result.accepted()).isFalse();
        assertThat(result.reason()).contains(reasonFragment);
    }

    private static final class NoopMqttCommandPublisherService extends MqttCommandPublisherService {
        private NoopMqttCommandPublisherService() {
            super(new ObjectMapper(), "tcp://127.0.0.1:1", "test");
        }

        @Override
        public void publishSessionStart(SessionStartCommandPayload payload) {
        }

        @Override
        public void publishSessionStop(SessionStopCommandPayload payload) {
        }
    }

    private static final class InMemoryLocalSessionRepository extends LocalSessionRepository {
        private SessionEndResponse lastSaved;

        private InMemoryLocalSessionRepository() {
            super("target/active-session-service-test.sqlite");
        }

        @Override
        public synchronized void save(SessionEndResponse session) {
            lastSaved = session;
        }

        @Override
        public synchronized Optional<SessionEndResponse> findById(String sessionId) {
            return lastSaved != null && lastSaved.sessionId().equals(sessionId) ? Optional.of(lastSaved) : Optional.empty();
        }

        @Override
        public synchronized List<SessionEndResponse> findAll() {
            return lastSaved == null ? List.of() : List.of(lastSaved);
        }
    }

    private static final class NoopLiveStreamService extends LiveStreamService {
        @Override
        public void publishSessionLive(String sessionId, lk.resq.localhub.model.SessionLiveView payload) {
        }
    }

    private record ServiceFixture(
            ActiveSessionService service,
            ManikinRegistryService registry,
            FirmwarePersistenceRepository repository
    ) {
    }
}
