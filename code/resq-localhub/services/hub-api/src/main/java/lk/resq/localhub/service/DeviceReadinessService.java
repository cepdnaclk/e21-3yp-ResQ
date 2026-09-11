package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.JsonNode;
import lk.resq.localhub.model.firmware.CalibrationMqttEvent;
import lk.resq.localhub.model.firmware.CalibrationState;
import lk.resq.localhub.model.firmware.DeviceReadinessState;
import lk.resq.localhub.model.firmware.DeviceRuntimeState;
import lk.resq.localhub.model.firmware.RuntimeOrderingConfidence;
import lk.resq.localhub.model.firmware.RuntimeMessageApplyResult;
import lk.resq.localhub.model.firmware.RuntimeMessageDisposition;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Optional;

@Service
public class DeviceReadinessService {

    private static final Logger logger = LoggerFactory.getLogger(DeviceReadinessService.class);

    private final DeviceRuntimeStateService runtimeStateService;
    private final CalibrationProfileIdentityValidator identityValidator;

    @Autowired
    public DeviceReadinessService(
            DeviceRuntimeStateService runtimeStateService,
            CalibrationProfileIdentityValidator identityValidator
    ) {
        this.runtimeStateService = runtimeStateService;
        this.identityValidator = identityValidator;
    }

    public Optional<DeviceRuntimeState> findRuntimeState(String deviceId) {
        return runtimeStateService.find(deviceId);
    }

    public DeviceReadinessState getReadiness(String deviceId) {
        if (deviceId == null) {
            return null;
        }
        return toReadinessState(runtimeStateService.getOrCreate(deviceId));
    }

    public boolean isReadyForSession(String deviceId) {
        if (deviceId == null) {
            return false;
        }
        return findRuntimeState(deviceId).map(this::checkReadyForSession).orElse(false);
    }

    public DeviceReadinessState markCalibrationStartRequested(String deviceId, String requestId) {
        if (deviceId == null) {
            return null;
        }

        DeviceRuntimeState state = runtimeStateService.markCalibrationStartRequested(deviceId, requestId);
        logger.info("Marked runtime readiness STARTING (requested) for deviceId={}, requestId={}", deviceId, requestId);
        return toReadinessState(state, requestId);
    }

    public DeviceReadinessState handleStatus(String deviceId, JsonNode payload) {
        RuntimeMessageApplyResult result = handleStatusResult(deviceId, payload);
        return result == null ? null : toReadinessState(result.state());
    }

    public RuntimeMessageApplyResult handleStatusResult(String deviceId, JsonNode payload) {
        if (deviceId == null) {
            return null;
        }
        return runtimeStateService.applyStatusResult(deviceId, payload);
    }

    public DeviceReadinessState handleHeartbeat(String deviceId, JsonNode payload) {
        RuntimeMessageApplyResult result = handleHeartbeatResult(deviceId, payload);
        return result == null ? null : toReadinessState(result.state());
    }

    public RuntimeMessageApplyResult handleHeartbeatResult(String deviceId, JsonNode payload) {
        if (deviceId == null) {
            return null;
        }
        return runtimeStateService.applyHeartbeatResult(deviceId, payload);
    }

    public DeviceReadinessState handleCalibrationEvent(String deviceId, CalibrationMqttEvent event) {
        RuntimeMessageApplyResult result = handleCalibrationEventResult(deviceId, event);
        if (result == null || result.state() == null) {
            return null;
        }
        if (!result.domainMutationAllowed()) {
            return toReadinessState(result.state());
        }
        return toReadinessState(
                result.state(),
                event.replyId(),
                event.progressId(),
                event.reasonId(),
                event.actionId()
        );
    }

    public RuntimeMessageApplyResult handleCalibrationEventResult(String deviceId, CalibrationMqttEvent event) {
        if (deviceId == null || event == null) {
            return null;
        }

        logger.info("Received calibration event deviceId={} eventId={} progressId={} state={}",
                deviceId, event.eventId(), event.progressId(), event.firmwareState());

        if (event.eventId() == null) {
            logger.warn("Received calibration event with missing eventId for deviceId={}", deviceId);
            DeviceRuntimeState state = runtimeStateService.getOrCreate(deviceId);
            return new RuntimeMessageApplyResult(RuntimeMessageDisposition.INVALID_ORDERING_FIELDS, state, false, state.bootId(), state.bootId());
        }

        if (event.eventId() != 4000 && event.eventId() != 4001 && event.eventId() != 4002) {
            logger.warn("Received calibration event with unknown eventId={} for deviceId={}", event.eventId(), deviceId);
            DeviceRuntimeState state = runtimeStateService.getOrCreate(deviceId);
            return new RuntimeMessageApplyResult(RuntimeMessageDisposition.INVALID_ORDERING_FIELDS, state, false, state.bootId(), state.bootId());
        }

        RuntimeMessageApplyResult result = runtimeStateService.applyCalibrationEventResult(deviceId, event);
        DeviceReadinessState readiness = toReadinessState(result.state(), event.replyId(), event.progressId(), event.reasonId(), event.actionId());
        logger.info("Updated runtime readiness deviceId={} calibrationState={} readyForSession={}",
                deviceId, readiness.calibrationState(), readiness.readyForSession());
        return result;
    }

    public DeviceReadinessState toReadinessState(DeviceRuntimeState state) {
        return toReadinessState(state, state == null ? null : state.lastReplyId(), null, null, null);
    }

    private DeviceReadinessState toReadinessState(DeviceRuntimeState state, String replyId) {
        return toReadinessState(state, replyId, null, null, null);
    }

    public boolean checkReadyForSession(DeviceRuntimeState state) {
        if (state == null) {
            return false;
        }

        // 1. connected
        if (state.lastSeenEpochMs() <= 0) {
            return false;
        }

        // 2. correct firmware state
        String firmwareState = state.firmwareState();
        if (firmwareState == null || !"READY_FOR_SESSION".equalsIgnoreCase(firmwareState.trim())) {
            return false;
        }

        // 3. calibrated
        if (!state.calibrated()) {
            return false;
        }

        // 4. no active session
        if (state.sessionActive()) {
            return false;
        }

        // 5. no recalibration requirement
        if (state.recalibrationRequired() == null || state.recalibrationRequired()) {
            return false;
        }

        // 6. accepted ordering (not UNKNOWN)
        if (state.orderingConfidence() == RuntimeOrderingConfidence.UNKNOWN) {
            return false;
        }

        // 7. valid profile identity
        CalibrationProfileIdentityValidator.ValidationResult valResult = identityValidator.validate(
                state.calibrationSchemaVersion(),
                state.calibrationGeneration(),
                state.calibrationStorageStatus(),
                state.recalibrationRequired(),
                state.calibrationProfileId(),
                state.profileVersion(),
                state.profileHash()
        );
        return valResult.valid();
    }

    private DeviceReadinessState toReadinessState(
            DeviceRuntimeState state,
            String replyId,
            Integer progressId,
            String reasonId,
            Integer actionId
    ) {
        if (state == null) {
            return null;
        }

        boolean derivedReady = checkReadyForSession(state);

        return new DeviceReadinessState(
                state.deviceId(),
                calibrationState(state.calibrationState()),
                state.firmwareState(),
                progressId != null ? progressId : state.currentProgressId(),
                reasonId != null ? reasonId : (state.lastReasonId() != null ? state.lastReasonId() : "00000"),
                actionId != null ? actionId : (state.lastActionId() != null ? state.lastActionId() : 0),
                state.lastCalibrationResult(),
                replyId != null ? replyId : state.lastReplyId(),
                derivedReady,
                state.lastSeenEpochMs() > 0 ? Instant.ofEpochMilli(state.lastSeenEpochMs()) : Instant.now(),
                state.calibrationSchemaVersion(),
                state.calibrationGeneration(),
                state.calibrationStorageStatus(),
                state.recalibrationRequired(),
                state.profileVersion(),
                state.profileHash()
        );
    }

    private static CalibrationState calibrationState(String value) {
        if (value == null || value.isBlank()) {
            return CalibrationState.UNKNOWN;
        }
        try {
            return CalibrationState.valueOf(value.trim().toUpperCase());
        } catch (IllegalArgumentException ignored) {
            return CalibrationState.UNKNOWN;
        }
    }
}
