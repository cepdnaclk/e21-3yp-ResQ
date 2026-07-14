package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.JsonNode;
import lk.resq.localhub.model.firmware.CalibrationMqttEvent;
import lk.resq.localhub.model.firmware.CalibrationState;
import lk.resq.localhub.model.firmware.DeviceReadinessState;
import lk.resq.localhub.model.firmware.DeviceRuntimeState;
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

    public DeviceReadinessService() {
        this(new DeviceRuntimeStateService());
    }

    @Autowired
    public DeviceReadinessService(DeviceRuntimeStateService runtimeStateService) {
        this.runtimeStateService = runtimeStateService;
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
        return runtimeStateService.isReadyForSession(deviceId);
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

    public static DeviceReadinessState toReadinessState(DeviceRuntimeState state) {
        return toReadinessState(state, state == null ? null : state.lastReplyId());
    }

    private static DeviceReadinessState toReadinessState(DeviceRuntimeState state, String replyId) {
        return toReadinessState(state, replyId, null, null, null);
    }

    private static final String SENTINEL_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

    private static boolean deriveReadyForSessionStrict(
            String firmwareState,
            boolean calibrated,
            boolean sessionActive,
            String storageStatus,
            Boolean recalibrationRequired,
            String profileId,
            Integer profileVersion,
            String profileHash
    ) {
        if (firmwareState == null) return false;
        String norm = firmwareState.trim().toUpperCase();
        if (!"READY_FOR_SESSION".equals(norm)) return false;
        if (!calibrated) return false;
        if (sessionActive) return false;

        // Legacy fallback: if ALL Phase 8 metadata fields are absent (or only sentinel hash),
        // this is a pre-Phase-8 report. Fall back to simple readiness.
        boolean hasMetadata = (storageStatus != null && !storageStatus.isBlank())
                || (profileId != null && !profileId.isBlank())
                || (profileVersion != null)
                || (profileHash != null && !profileHash.isBlank() && !SENTINEL_HASH.equals(profileHash.trim()));
        if (!hasMetadata) {
            return true;
        }

        // Full Phase 8 strict checks
        if (!"VALID".equalsIgnoreCase(storageStatus)) return false;
        if (recalibrationRequired == null || recalibrationRequired) return false;
        // When firmware reports the sentinel hash it has no real Phase 8 profile identity — skip
        // profile identity checks.
        boolean isSentinel = SENTINEL_HASH.equals(profileHash == null ? null : profileHash.trim());
        if (!isSentinel) {
            if (profileId == null || profileId.trim().isEmpty()) return false;
            if (profileVersion == null || profileVersion <= 0) return false;
            if (profileHash == null || profileHash.trim().length() != 64 || !profileHash.trim().matches("^[0-9a-fA-F]{64}$")) return false;
        }
        return true;
    }

    private static DeviceReadinessState toReadinessState(
            DeviceRuntimeState state,
            String replyId,
            Integer progressId,
            String reasonId,
            Integer actionId
    ) {
        if (state == null) {
            return null;
        }

        boolean derivedReady = deriveReadyForSessionStrict(
                state.firmwareState(),
                state.calibrated(),
                state.sessionActive(),
                state.calibrationStorageStatus(),
                state.recalibrationRequired(),
                state.calibrationProfileId(),
                state.profileVersion(),
                state.profileHash()
        );

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
