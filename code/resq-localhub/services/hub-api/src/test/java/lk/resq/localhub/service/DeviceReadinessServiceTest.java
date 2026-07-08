package lk.resq.localhub.service;

import lk.resq.localhub.model.firmware.CalibrationMqttEvent;
import lk.resq.localhub.model.firmware.CalibrationState;
import lk.resq.localhub.model.firmware.DeviceReadinessState;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

class DeviceReadinessServiceTest {

    private final DeviceReadinessService service = new DeviceReadinessService();

    @Test
    void getReadinessReturnsDefaultUnknownStateForNewDevice() {
        DeviceReadinessState state = service.getReadiness("device-01");
        assertThat(state).isNotNull();
        assertThat(state.deviceId()).isEqualTo("device-01");
        assertThat(state.calibrationState()).isEqualTo(CalibrationState.UNKNOWN);
        assertThat(state.readyForSession()).isFalse();
        assertThat(service.isReadyForSession("device-01")).isFalse();
    }

    @Test
    void event4000AckUpdatesToStartingOrCalibratingAndSetsProgressOne() {
        CalibrationMqttEvent startingEvent = new CalibrationMqttEvent(
                "device-01",
                4000,
                "req-1",
                "ACK",
                null,
                null,
                null,
                null,
                "STARTING",
                1000L,
                Instant.now()
        );
        DeviceReadinessState state = service.handleCalibrationEvent("device-01", startingEvent);
        assertThat(state.calibrationState()).isEqualTo(CalibrationState.STARTING);
        assertThat(state.currentProgressId()).isEqualTo(1);
        assertThat(state.readyForSession()).isFalse();

        CalibrationMqttEvent calibratingEvent = new CalibrationMqttEvent(
                "device-01",
                4000,
                "req-2",
                "ACK",
                null,
                null,
                null,
                null,
                "CALIBRATING",
                1001L,
                Instant.now()
        );
        DeviceReadinessState state2 = service.handleCalibrationEvent("device-01", calibratingEvent);
        assertThat(state2.calibrationState()).isEqualTo(CalibrationState.CALIBRATING);
        assertThat(state2.currentProgressId()).isEqualTo(1);
    }

    @Test
    void event4000NackUpdatesToFailed() {
        CalibrationMqttEvent nackEvent = new CalibrationMqttEvent(
                "device-01",
                4000,
                "req-1",
                "NACK",
                null,
                null,
                null,
                null,
                "ERROR",
                1000L,
                Instant.now()
        );
        DeviceReadinessState state = service.handleCalibrationEvent("device-01", nackEvent);
        assertThat(state.calibrationState()).isEqualTo(CalibrationState.FAILED);
        assertThat(state.readyForSession()).isFalse();
    }

    @Test
    void event4001WithProgressTwoUpdatesToCalibrating() {
        CalibrationMqttEvent progressEvent = new CalibrationMqttEvent(
                "device-01",
                4001,
                null,
                null,
                2,
                null,
                "00000",
                0,
                "CALIBRATING",
                1002L,
                Instant.now()
        );
        DeviceReadinessState state = service.handleCalibrationEvent("device-01", progressEvent);
        assertThat(state.calibrationState()).isEqualTo(CalibrationState.CALIBRATING);
        assertThat(state.currentProgressId()).isEqualTo(2);
        assertThat(state.readyForSession()).isFalse();
    }

    @Test
    void event4001WithProgressTwelveUpdatesToFailed() {
        CalibrationMqttEvent failEvent = new CalibrationMqttEvent(
                "device-01",
                4001,
                null,
                null,
                12,
                null,
                "10001",
                5,
                "CALIBRATION_FAIL",
                1003L,
                Instant.now()
        );
        DeviceReadinessState state = service.handleCalibrationEvent("device-01", failEvent);
        assertThat(state.calibrationState()).isEqualTo(CalibrationState.FAILED);
        assertThat(state.currentProgressId()).isEqualTo(12);
        assertThat(state.readyForSession()).isFalse();
    }

    @Test
    void event4001WithProgressThirteenUpdatesToInterrupted() {
        CalibrationMqttEvent interruptEvent = new CalibrationMqttEvent(
                "device-01",
                4001,
                null,
                null,
                13,
                null,
                "00000",
                0,
                "PAIRED_IDLE",
                1004L,
                Instant.now()
        );
        DeviceReadinessState state = service.handleCalibrationEvent("device-01", interruptEvent);
        assertThat(state.calibrationState()).isEqualTo(CalibrationState.INTERRUPTED);
        assertThat(state.currentProgressId()).isEqualTo(13);
        assertThat(state.readyForSession()).isFalse();
    }

    @Test
    void event4002WithResultPassUpdatesToReadyAndReadyForSession() {
        CalibrationMqttEvent passEvent = new CalibrationMqttEvent(
                "device-01",
                4002,
                "req-1",
                "ACK",
                11,
                "PASS",
                "00000",
                0,
                "READY_FOR_SESSION",
                1005L,
                Instant.now()
        );
        DeviceReadinessState state = service.handleCalibrationEvent("device-01", passEvent);
        assertThat(state.calibrationState()).isEqualTo(CalibrationState.READY);
        assertThat(state.readyForSession()).isTrue();
        assertThat(service.isReadyForSession("device-01")).isTrue();
    }

    @Test
    void event4002WithPassWithWarningsUpdatesToReadyAndReadyForSession() {
        CalibrationMqttEvent passWithWarningsEvent = new CalibrationMqttEvent(
                "device-01",
                4002,
                "req-1",
                "ACK",
                11,
                "PASS_WITH_WARNINGS",
                "08411",
                0,
                "READY_FOR_SESSION",
                1005L,
                Instant.now()
        );
        DeviceReadinessState state = service.handleCalibrationEvent("device-01", passWithWarningsEvent);
        assertThat(state.calibrationState()).isEqualTo(CalibrationState.READY);
        assertThat(state.readyForSession()).isTrue();
        assertThat(service.isReadyForSession("device-01")).isTrue();
        assertThat(state.lastReasonId()).isEqualTo("08411");
    }

    @Test
    void event4002WithResultFailOrStatusNackUpdatesToFailed() {
        CalibrationMqttEvent failEvent = new CalibrationMqttEvent(
                "device-01",
                4002,
                "req-1",
                "ACK",
                12,
                "FAIL",
                "00002",
                3,
                "CALIBRATION_FAIL",
                1006L,
                Instant.now()
        );
        DeviceReadinessState state = service.handleCalibrationEvent("device-01", failEvent);
        assertThat(state.calibrationState()).isEqualTo(CalibrationState.FAILED);
        assertThat(state.readyForSession()).isFalse();

        CalibrationMqttEvent nackEvent = new CalibrationMqttEvent(
                "device-01",
                4002,
                "req-1",
                "NACK",
                null,
                null,
                null,
                null,
                "ERROR",
                1007L,
                Instant.now()
        );
        DeviceReadinessState state2 = service.handleCalibrationEvent("device-01", nackEvent);
        assertThat(state2.calibrationState()).isEqualTo(CalibrationState.FAILED);
        assertThat(state2.readyForSession()).isFalse();
    }

    @Test
    void event4002WithResultCancelledUpdatesToCancelled() {
        CalibrationMqttEvent cancelEvent = new CalibrationMqttEvent(
                "device-01",
                4002,
                "req-1",
                "ACK",
                0,
                "CANCELLED",
                "00000",
                0,
                "PAIRED_IDLE",
                1008L,
                Instant.now()
        );
        DeviceReadinessState state = service.handleCalibrationEvent("device-01", cancelEvent);
        assertThat(state.calibrationState()).isEqualTo(CalibrationState.CANCELLED);
        assertThat(state.readyForSession()).isFalse();
    }

    @Test
    void malformedOrMissingOptionalFieldsDoNotCrashAndApplyDefaults() {
        CalibrationMqttEvent missingFieldsEvent = new CalibrationMqttEvent(
                "device-01",
                4001,
                null,
                null,
                2,
                null,
                null, // missing reason_id
                null, // missing action_id
                null,
                null,
                Instant.now()
        );
        DeviceReadinessState state = service.handleCalibrationEvent("device-01", missingFieldsEvent);
        assertThat(state).isNotNull();
        assertThat(state.lastReasonId()).isEqualTo("00000");
        assertThat(state.lastActionId()).isEqualTo(0);
    }

    @Test
    void unknownOrMissingEventIdIsIgnoredWithoutChangingState() {
        // First establish a known state
        CalibrationMqttEvent progressEvent = new CalibrationMqttEvent(
                "device-01",
                4001,
                null,
                null,
                2,
                null,
                "00000",
                0,
                "CALIBRATING",
                1002L,
                Instant.now()
        );
        DeviceReadinessState baseState = service.handleCalibrationEvent("device-01", progressEvent);
        
        CalibrationMqttEvent unknownEvent = new CalibrationMqttEvent(
                "device-01",
                9999,
                null,
                null,
                5,
                "SOME_RESULT",
                "00000",
                0,
                "SOME_STATE",
                1010L,
                Instant.now()
        );
        
        DeviceReadinessState stateAfterUnknown = service.handleCalibrationEvent("device-01", unknownEvent);
        assertThat(stateAfterUnknown.calibrationState()).isEqualTo(baseState.calibrationState());
        assertThat(stateAfterUnknown.currentProgressId()).isEqualTo(baseState.currentProgressId());
        assertThat(stateAfterUnknown.lastUpdatedAt()).isEqualTo(baseState.lastUpdatedAt());

        CalibrationMqttEvent missingEventId = new CalibrationMqttEvent(
                "device-01",
                null,
                null,
                null,
                5,
                "SOME_RESULT",
                "00000",
                0,
                "SOME_STATE",
                1010L,
                Instant.now()
        );
        DeviceReadinessState stateAfterMissing = service.handleCalibrationEvent("device-01", missingEventId);
        assertThat(stateAfterMissing.calibrationState()).isEqualTo(baseState.calibrationState());
    }

    @Test
    void event4001WithMissingProgressIdDoesNotBreakReadiness() {
        CalibrationMqttEvent progressEvent = new CalibrationMqttEvent(
                "device-01",
                4001,
                null,
                null,
                null, // progressId is missing
                null,
                "00000",
                0,
                "CALIBRATING",
                1002L,
                Instant.now()
        );
        DeviceReadinessState state = service.handleCalibrationEvent("device-01", progressEvent);
        assertThat(state.calibrationState()).isEqualTo(CalibrationState.CALIBRATING);
        assertThat(state.currentProgressId()).isNull(); // should keep null or previous null
        assertThat(state.readyForSession()).isFalse();
    }
}
