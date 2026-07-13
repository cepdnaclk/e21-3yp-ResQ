package lk.resq.localhub.service;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.localhub.model.SessionEndRequest;
import lk.resq.localhub.model.SessionEndResponse;
import lk.resq.localhub.model.SessionLifecycleState;
import lk.resq.localhub.model.SessionStartRequest;
import lk.resq.localhub.model.SessionStartResponse;
import lk.resq.localhub.model.SessionStartCommandPayload;
import lk.resq.localhub.model.SessionStopCommandPayload;
import lk.resq.localhub.model.firmware.FirmwareCalibrationResultRecord;
import lk.resq.localhub.model.firmware.CalibrationMqttEvent;
import lk.resq.localhub.service.CalibrationNotReadyException;
import lk.resq.localhub.service.CalibrationProfileRepository;
import lk.resq.localhub.service.CalibrationProfileService;
import lk.resq.localhub.service.SyncQueueRepository;
import lk.resq.localhub.service.SyncQueueService;
import org.junit.jupiter.api.Test;

import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
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
                null,
                "Guest",
                "adult-basic",
                "Validation smoke",
                null
        ));
        activate(service, session);

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
                null,
                "Guest",
                "adult-basic",
                "Compatibility smoke",
                null
        ));
        activate(service, session);

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
                null,
                "Guest",
                "adult-basic",
                "Depth progress smoke",
                null
        ));
        activate(service, session);

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
        assertThat(liveView.latestDepthMm()).isEqualTo(39.0);
        assertThat(liveView.latestRateCpm()).isEqualTo(111.0);
        assertThat(liveView.latestMetric()).isNotNull();
        assertThat(liveView.latestMetric().depthProgress()).isEqualTo(0.78);
        assertThat(liveView.latestMetric().depthOk()).isTrue();
        assertThat(liveView.latestMetric().compressionCount()).isEqualTo(1);
        SessionEndResponse completed = service.endSession(new SessionEndRequest(session.sessionId()));
        assertThat(completed.summary().sampleCount()).isEqualTo(1);
        assertThat(completed.summary().totalCompressions()).isEqualTo(1);
        assertThat(completed.summary().validCompressions()).isEqualTo(1);
        assertThat(completed.summary().avgDepthMm()).isEqualTo(39.0);
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
                null,
                "Guest",
                "adult-basic",
                "Live update smoke",
                null
        ));
        activate(service, session);

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
                null,
                "Guest",
                "adult-basic",
                "Depth smoke",
                null
        ));
        activate(service, session);

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
                null,
                "Guest",
                "adult-basic",
                "Validation smoke",
                null
        ));
        activate(service, session);

        JsonNode first = telemetry("M01", session.sessionId(), 1, 52, 110);
        service.recordTelemetry("M01", first);
        assertRejected(service.validateTelemetryBinding("M01", telemetry("M01", session.sessionId(), 1, 53, 111)), "seq is not newer");
        service.endSession(new SessionEndRequest(session.sessionId()));
        assertRejected(service.validateTelemetryBinding("M01", telemetry("M01", session.sessionId(), 2, 54, 112)), "session is not active");
    }
    @Test
    void blocksSessionStartForKnownNotReadyFirmwareDevice() throws Exception {
        ServiceFixture fixture = newServiceFixture();
        fixture.readinessService.handleStatus("M01", objectMapper.readTree("""
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
                null,
                "Guest",
                "adult-basic",
                "Blocked readiness",
                null
        ))).isInstanceOf(CalibrationNotReadyException.class)
                .hasMessageContaining("Run calibration before starting a CPR session.");
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
        fixture.readinessService.handleStatus("M01", objectMapper.readTree("""
                {
                  "deviceId": "M01",
                  "state": "READY_FOR_SESSION",
                  "session_active": false,
                  "calibrated": true
                }
                """));
        SessionStartResponse session = fixture.service.startSession(new SessionStartRequest(
                "M01",
                null,
                null,
                null,
                null,
                "Guest",
                "adult-basic",
                "Ready firmware",
                null
        ));
        assertThat(session.deviceId()).isEqualTo("M01");
        assertThat(session.active()).isFalse();
        assertThat(session.state()).isEqualTo(SessionLifecycleState.START_PENDING);
        assertThat(session.requestId()).isNotBlank();
        assertThat(session.profileId()).isEqualTo("adult-basic");
        assertThat(session.scenario()).isEqualTo("Ready firmware");
        assertThat(fixture.commandPublisher.publishedSessionStarts).singleElement().satisfies(payload -> {
            assertThat(payload.profileId()).isEqualTo("adult-basic");
            assertThat(payload.scenario()).isEqualTo("Ready firmware");
        });
    }

    @Test
    void profileMismatchIsRejectedBeforeReservationOrPublish() throws Exception {
        ServiceFixture fixture = newServiceFixture();
        assertThatThrownBy(() -> fixture.service.startSession(new SessionStartRequest(
                "M01",
                null,
                null,
                null,
                null,
                "Guest",
                "child-basic",
                "Mismatch",
                null
        ))).isInstanceOf(CalibrationProfileValidationException.class)
                .hasMessageContaining("does not match calibrated profile adult-basic");
        assertThat(fixture.commandPublisher.publishedSessionStarts).isEmpty();
        assertThat(fixture.service.findActiveSessionForDevice("M01")).isEmpty();
    }

    @Test
    void missingProfileIsRejectedBeforePublish() throws Exception {
        ServiceFixture fixture = newServiceFixture();
        assertThatThrownBy(() -> fixture.service.startSession(new SessionStartRequest(
                "M01",
                null,
                null,
                null,
                null,
                "Guest",
                null,
                "Missing profile",
                null
        ))).isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("profileId is required");
        assertThat(fixture.commandPublisher.publishedSessionStarts).isEmpty();
    }

    @Test
    void unknownRuntimeProfileIsRejectedBeforePublish() throws Exception {
        ServiceFixture fixture = newServiceFixture();
        fixture.readinessService.handleStatus("M03", objectMapper.readTree("""
                {
                  "state": "READY_FOR_SESSION",
                  "calibrated": true,
                  "session_active": false
                }
                """));
        assertThatThrownBy(() -> fixture.service.startSession(new SessionStartRequest(
                "M03",
                null,
                null,
                null,
                null,
                "Guest",
                "adult-basic",
                "Unknown profile",
                null
        ))).isInstanceOf(CalibrationProfileValidationException.class)
                .hasMessageContaining("Cannot verify the calibrated profile");
        assertThat(fixture.commandPublisher.publishedSessionStarts).isEmpty();
    }
    @Test
    void sessionStartBlockedWhenReadinessUnknown() throws Exception {
        ServiceFixture fixture = newServiceFixture();
        // M03 starts with UNKNOWN state by default since we haven't configured it
        assertThatThrownBy(() -> fixture.service.startSession(new SessionStartRequest(
                "M03",
                null,
                null,
                null,
                null,
                "Guest",
                "adult-basic",
                "Blocked unknown",
                null
        ))).isInstanceOf(CalibrationNotReadyException.class)
                .hasMessageContaining("Run calibration before starting a CPR session.");
    }
    @Test
    void sessionStartBlockedWhenReadinessFailed() throws Exception {
        ServiceFixture fixture = newServiceFixture();
        // Simulate a FAIL calibration event
        fixture.readinessService.handleCalibrationEvent("M01", new CalibrationMqttEvent(
                "M01",
                4002,
                "reply-1",
                "ACK",
                12,
                "FAIL",
                "00000",
                0,
                "CALIBRATION_FAIL",
                100L,
                Instant.now(),
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                "adult-basic"
        ));
        assertThatThrownBy(() -> fixture.service.startSession(new SessionStartRequest(
                "M01",
                null,
                null,
                null,
                null,
                "Guest",
                "adult-basic",
                "Blocked failed",
                null
        ))).isInstanceOf(CalibrationNotReadyException.class)
                .hasMessageContaining("Run calibration before starting a CPR session.");
    }
    @Test
    void sessionStartBlockedWhenReadinessCalibrating() throws Exception {
        ServiceFixture fixture = newServiceFixture();
        // Simulate a calibrating state (eventId 4001, progress 2)
        fixture.readinessService.handleCalibrationEvent("M01", new CalibrationMqttEvent(
                "M01",
                4001,
                "reply-1",
                "ACK",
                2,
                null,
                "00000",
                0,
                "CALIBRATING",
                101L,
                Instant.now(),
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                "child-basic"
        ));
        assertThatThrownBy(() -> fixture.service.startSession(new SessionStartRequest(
                "M01",
                null,
                null,
                null,
                null,
                "Guest",
                "adult-basic",
                "Blocked calibrating",
                null
        ))).isInstanceOf(CalibrationNotReadyException.class)
                .hasMessageContaining("Run calibration before starting a CPR session.");
    }
    @Test
    void sessionStartAllowedWhenReadinessReady() throws Exception {
        ServiceFixture fixture = newServiceFixture();
        // M01 is pre-configured as READY in fixture setup
        SessionStartResponse session = fixture.service.startSession(new SessionStartRequest(
                "M01",
                null,
                null,
                null,
                null,
                "Guest",
                "adult-basic",
                "Allowed check",
                null
        ));

        assertThat(session.deviceId()).isEqualTo("M01");
        assertThat(session.active()).isFalse();
        assertThat(session.state()).isEqualTo(SessionLifecycleState.START_PENDING);
        assertThat(session.requestId()).isNotBlank();
    }

    @Test
    void matchingFirmwareAckActivatesPendingSession() throws Exception {
        ServiceFixture fixture = newServiceFixture();
        SessionStartResponse pending = fixture.service.startSession(startRequest("M01"));

        assertThat(pending.active()).isFalse();
        assertThat(pending.state()).isEqualTo(SessionLifecycleState.START_PENDING);

        assertThat(fixture.service.handleSessionStartFirmwareReply(
                "M01", 2000, pending.requestId(), "ACK", pending.sessionId(), null, "00000", 0
        )).isTrue();

        SessionStartResponse active = fixture.service.findSessionStart(pending.sessionId()).orElseThrow();
        assertThat(active.active()).isTrue();
        assertThat(active.state()).isEqualTo(SessionLifecycleState.ACTIVE);
        assertThat(fixture.service.findActiveSessionForDevice("M01")).isPresent();
    }

    @Test
    void nackRejectsPendingSessionAndAllowsRetry() throws Exception {
        ServiceFixture fixture = newServiceFixture();
        SessionStartResponse pending = fixture.service.startSession(startRequest("M01"));

        assertThat(fixture.service.handleSessionStartFirmwareReply(
                "M01", 1000, pending.requestId(), "NACK", pending.sessionId(), "PROFILE_MISMATCH", "12345", 7
        )).isTrue();

        SessionStartResponse rejected = fixture.service.findSessionStart(pending.sessionId()).orElseThrow();
        assertThat(rejected.active()).isFalse();
        assertThat(rejected.state()).isEqualTo(SessionLifecycleState.START_REJECTED);
        assertThat(fixture.service.findActiveSessionForDevice("M01")).isEmpty();

        SessionStartResponse retry = fixture.service.startSession(startRequest("M01"));
        assertThat(retry.sessionId()).isNotEqualTo(pending.sessionId());
        assertThat(retry.state()).isEqualTo(SessionLifecycleState.START_PENDING);
    }

    @Test
    void pendingStartBlocksDuplicateUntilTimeoutThenAllowsRetry() throws Exception {
        MutableClock clock = new MutableClock(Instant.parse("2026-07-13T00:00:00Z"));
        ServiceFixture fixture = newServiceFixture(clock, 1_000L);
        SessionStartResponse pending = fixture.service.startSession(startRequest("M01"));

        assertThatThrownBy(() -> fixture.service.startSession(startRequest("M01")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("reserved session");

        clock.advanceMillis(1_001L);
        assertThat(fixture.service.expirePendingSessionStarts()).isEqualTo(1);
        assertThat(fixture.service.findSessionStart(pending.sessionId()).orElseThrow().state())
                .isEqualTo(SessionLifecycleState.START_TIMEOUT);
        assertThat(fixture.service.findActiveSessionForDevice("M01")).isEmpty();

        assertThat(fixture.service.startSession(startRequest("M01")).state())
                .isEqualTo(SessionLifecycleState.START_PENDING);
    }

    @Test
    void lateOrMismatchedRepliesDoNotActivatePendingSession() throws Exception {
        MutableClock clock = new MutableClock(Instant.parse("2026-07-13T00:00:00Z"));
        ServiceFixture fixture = newServiceFixture(clock, 1_000L);
        SessionStartResponse pending = fixture.service.startSession(startRequest("M01"));

        assertThat(fixture.service.handleSessionStartFirmwareReply(
                "M02", 2000, pending.requestId(), "ACK", pending.sessionId(), null, "00000", 0
        )).isFalse();
        assertThat(fixture.service.handleSessionStartFirmwareReply(
                "M01", 2000, "req-300-9999", "ACK", pending.sessionId(), null, "00000", 0
        )).isFalse();
        assertThat(fixture.service.handleSessionStartFirmwareReply(
                "M01", 2000, pending.requestId(), "ACK", "wrong-session", null, "00000", 0
        )).isFalse();

        clock.advanceMillis(1_001L);
        fixture.service.expirePendingSessionStarts();
        assertThat(fixture.service.handleSessionStartFirmwareReply(
                "M01", 2000, pending.requestId(), "ACK", pending.sessionId(), null, "00000", 0
        )).isFalse();
        assertThat(fixture.service.findSessionStart(pending.sessionId()).orElseThrow().state())
                .isEqualTo(SessionLifecycleState.START_TIMEOUT);
    }
    @Test
    void noMqttSessionStartPublishedWhenCalibrationNotReady() throws Exception {
        CapturingMqttCommandPublisherService commandPublisher = new CapturingMqttCommandPublisherService();
        LocalSessionRepository sessionRepository = new InMemoryLocalSessionRepository();
        LiveStreamService liveStreamService = new NoopLiveStreamService();
        TraineeRecordsRepository traineeRecordsRepository = new TraineeRecordsRepository();
        ManikinRegistryService registry = new ManikinRegistryService(12);
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
        DeviceReadinessService readinessService = new DeviceReadinessService();
        ActiveSessionService service = new ActiveSessionService(
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
        assertThatThrownBy(() -> service.startSession(new SessionStartRequest(
                "M03",
                null,
                null,
                null,
                null,
                "Guest",
                "adult-basic",
                "MQTT Blocked check",
                null
        ))).isInstanceOf(CalibrationNotReadyException.class);
        assertThat(commandPublisher.publishStartCount).isEqualTo(0);
    }
    private ActiveSessionService newService() throws Exception {
        return newServiceFixture().service;
    }

    private ServiceFixture newServiceFixture() throws Exception {
        return newServiceFixture(Clock.systemUTC(), 7000L);
    }

    private ServiceFixture newServiceFixture(Clock clock, long startAckTimeoutMs) throws Exception {
        NoopMqttCommandPublisherService commandPublisher = new NoopMqttCommandPublisherService();
        LocalSessionRepository sessionRepository = new InMemoryLocalSessionRepository();
        LiveStreamService liveStreamService = new NoopLiveStreamService();
        TraineeRecordsRepository traineeRecordsRepository = new TraineeRecordsRepository();
        ManikinRegistryService registry = new ManikinRegistryService(12);
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
        DeviceReadinessService readinessService = new DeviceReadinessService();
        // Pre-configure M01 and M02 as READY
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
                Instant.now(),
                "adult-basic"
        ));
        readinessService.handleCalibrationEvent("M02", new CalibrationMqttEvent(
                "M02",
                4002,
                "reply-m02",
                "ACK",
                11,
                "PASS",
                "00000",
                0,
                "READY_FOR_SESSION",
                100L,
                Instant.now(),
                "child-basic"
        ));
        ActiveSessionService service = new ActiveSessionService(
                registry,
                commandPublisher,
                sessionRepository,
                liveStreamService,
                traineeRecordsRepository,
                firmwareCalibrationService,
                syncQueueService,
                null,
                new RateEstimatorRegistry(),
                readinessService,
                startAckTimeoutMs,
                clock
        );
        return new ServiceFixture(service, registry, firmwareRepository, readinessService, commandPublisher);
    }

    private static SessionStartRequest startRequest(String deviceId) {
        return new SessionStartRequest(deviceId, null, null, null, null, "Guest", "adult-basic", "Lifecycle", null);
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

    private void activate(ActiveSessionService service, SessionStartResponse session) {
        assertThat(service.handleSessionStartFirmwareReply(
                session.deviceId(),
                2000,
                session.requestId(),
                "ACK",
                session.sessionId(),
                null,
                "00000",
                0
        )).isTrue();
        assertThat(service.findSessionStart(session.sessionId()).orElseThrow().state())
                .isEqualTo(SessionLifecycleState.ACTIVE);
    }
    private void assertRejected(ActiveSessionService.TelemetryValidationResult result, String reasonFragment) {
        assertThat(result.accepted()).isFalse();
        assertThat(result.reason()).contains(reasonFragment);
    }
    private static final class NoopMqttCommandPublisherService extends MqttCommandPublisherService {
        private final List<SessionStartCommandPayload> publishedSessionStarts = new java.util.ArrayList<>();

        private NoopMqttCommandPublisherService() {
            super(new ObjectMapper(), "tcp://127.0.0.1:1", "test");
        }
        @Override
        public void publishSessionStart(SessionStartCommandPayload payload) {
            publishedSessionStarts.add(payload);
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
            FirmwarePersistenceRepository repository,
            DeviceReadinessService readinessService,
            NoopMqttCommandPublisherService commandPublisher
    ) {
    }
    private static final class CapturingMqttCommandPublisherService extends MqttCommandPublisherService {
        private int publishStartCount = 0;
        private CapturingMqttCommandPublisherService() {
            super(new ObjectMapper(), "tcp://127.0.0.1:1", "test");
        }
        @Override
        public void publishSessionStart(SessionStartCommandPayload payload) {
            publishStartCount++;
        }
    }

    private static final class MutableClock extends Clock {
        private Instant instant;

        private MutableClock(Instant instant) {
            this.instant = instant;
        }

        private void advanceMillis(long millis) {
            instant = instant.plusMillis(millis);
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
