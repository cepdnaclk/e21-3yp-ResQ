package lk.resq.localhub.service;

import lk.resq.localhub.model.firmware.CalibrationMqttEvent;
import lk.resq.localhub.model.firmware.CalibrationState;
import lk.resq.localhub.model.firmware.CalibrationStreamEvent;
import lk.resq.localhub.model.firmware.DeviceReadinessState;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class CalibrationStreamServiceTest {

    private TestIdentityValidator identityValidator;
    private DeviceReadinessService readinessService;

    @BeforeEach
    void setUp() {
        identityValidator = new TestIdentityValidator();
        readinessService = new DeviceReadinessService(new DeviceRuntimeStateService(), identityValidator);
    }

    @Test
    void subscribePushesInitialSnapshotImmediately() {
        // Register initial readiness
        readinessService.handleCalibrationEvent("M01", new CalibrationMqttEvent(
                "M01",
                4000,
                "req-200-0001",
                "ACK",
                null,
                null,
                "00000",
                0,
                "CALIBRATING",
                123456L,
                Instant.now()
        ));

        CapturingCalibrationStreamService service = new CapturingCalibrationStreamService(readinessService);
        service.subscribe("M01");

        assertThat(service.sentEvents).isNotEmpty();
        CapturedEvent snapshot = service.sentEvents.get(0);
        assertThat(snapshot.eventName()).isEqualTo("calibration_snapshot");
        assertThat(snapshot.payload()).isInstanceOf(CalibrationStreamEvent.class);
        CalibrationStreamEvent payload = (CalibrationStreamEvent) snapshot.payload();
        assertThat(payload.type()).isEqualTo("calibration_snapshot");
        assertThat(payload.calibrationState()).isEqualTo(CalibrationState.CALIBRATING);
    }

    @Test
    void publishCalibrationUpdateSendsToActiveEmitter() {
        CapturingCalibrationStreamService service = new CapturingCalibrationStreamService(readinessService);
        service.subscribe("M01");
        
        // Clear initial snapshot to focus on update
        service.sentEvents.clear();

        CalibrationMqttEvent progressEvent = new CalibrationMqttEvent(
                "M01",
                4001,
                null,
                null,
                5,
                null,
                "00000",
                0,
                "CALIBRATING",
                123456L,
                Instant.now()
        );

        DeviceReadinessState state = new DeviceReadinessState(
                "M01",
                CalibrationState.CALIBRATING,
                "CALIBRATING",
                5,
                "00000",
                0,
                null,
                null,
                false,
                Instant.now()
        );

        service.publishCalibrationUpdate("M01", progressEvent, state);

        assertThat(service.sentEvents).isNotEmpty();
        CapturedEvent update = service.sentEvents.get(0);
        assertThat(update.eventName()).isEqualTo("calibration_update");
        CalibrationStreamEvent payload = (CalibrationStreamEvent) update.payload();
        assertThat(payload.type()).isEqualTo("calibration_update");
        assertThat(payload.progressId()).isEqualTo(5);
    }

    @Test
    void publishCalibrationUpdatePreservesConvertedSensorFields() {
        CapturingCalibrationStreamService service = new CapturingCalibrationStreamService(readinessService);
        service.subscribe("M01");
        service.sentEvents.clear();

        CalibrationMqttEvent progressEvent = new CalibrationMqttEvent(
                "M01",
                4001,
                null,
                null,
                5,
                null,
                "00000",
                0,
                "CALIBRATING",
                123456L,
                Instant.now(),
                0.0,
                true,
                4.25,
                false,
                9.5,
                true,
                false,
                18.4,
                0.42,
                true,
                true,
                true,
                2,
                44.8
        );

        service.publishCalibrationUpdate("M01", progressEvent, null);

        CalibrationStreamEvent payload = (CalibrationStreamEvent) service.sentEvents.get(0).payload();
        assertThat(payload.pressure0Kpa()).isEqualTo(0.0);
        assertThat(payload.pressure0KpaValid()).isTrue();
        assertThat(payload.pressure1Kpa()).isEqualTo(4.25);
        assertThat(payload.pressure1KpaValid()).isFalse();
        assertThat(payload.pressureKpaValid()).isFalse();
        assertThat(payload.hallMm()).isEqualTo(18.4);
        assertThat(payload.hallProgress()).isEqualTo(0.42);
        assertThat(payload.samplePressureKpaValid()).isTrue();
        assertThat(payload.sampleHallMmValid()).isTrue();
        assertThat(payload.pressureSaturationMask()).isEqualTo(2);
        assertThat(payload.fullDepthMm()).isEqualTo(44.8);
    }

    @Test
    void failedEmitterIsRemovedSafely() {
        CalibrationStreamService service = new CalibrationStreamService(readinessService);
        SseEmitter emitter = service.subscribe("M01");

        // Force complete emitter
        emitter.complete();
        
        // Broadcast should execute without throwing exceptions even if client is closed
        service.publishCalibrationUpdate("M01", new CalibrationMqttEvent(
                "M01", 4001, null, null, 2, null, "00000", 0, "CALIBRATING", 123456L, Instant.now()
        ), null);
    }

    private static class CapturingCalibrationStreamService extends CalibrationStreamService {
        private final List<CapturedEvent> sentEvents = new java.util.ArrayList<>();

        private CapturingCalibrationStreamService(DeviceReadinessService readinessService) {
            super(readinessService);
        }

        @Override
        protected void sendEvent(SseEmitter emitter, String eventName, Object payload, Runnable onFailure) {
            sentEvents.add(new CapturedEvent(emitter, eventName, payload));
        }
    }

    private record CapturedEvent(SseEmitter emitter, String eventName, Object payload) {}
}
