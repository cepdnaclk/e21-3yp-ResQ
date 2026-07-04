package lk.resq.localhub.service;

import lk.resq.localhub.model.firmware.CalibrationMqttEvent;
import lk.resq.localhub.model.firmware.CalibrationState;
import lk.resq.localhub.model.firmware.DeviceReadinessState;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class DeviceReadinessService {

    private static final Logger logger = LoggerFactory.getLogger(DeviceReadinessService.class);

    private final ConcurrentHashMap<String, DeviceReadinessState> readinessMap = new ConcurrentHashMap<>();

    public DeviceReadinessState getReadiness(String deviceId) {
        if (deviceId == null) {
            return null;
        }
        return readinessMap.computeIfAbsent(deviceId, id -> new DeviceReadinessState(
                id,
                CalibrationState.UNKNOWN,
                null,
                null,
                null,
                null,
                null,
                null,
                false,
                Instant.now()
        ));
    }

    public boolean isReadyForSession(String deviceId) {
        DeviceReadinessState state = getReadiness(deviceId);
        return state != null && state.readyForSession();
    }

    public DeviceReadinessState markCalibrationStartRequested(String deviceId, String requestId) {
        if (deviceId == null) {
            return null;
        }

        DeviceReadinessState previous = getReadiness(deviceId);
        DeviceReadinessState nextState = new DeviceReadinessState(
                deviceId,
                CalibrationState.STARTING,
                previous.firmwareState(),
                1,
                previous.lastReasonId(),
                previous.lastActionId(),
                previous.lastResult(),
                requestId,
                false,
                Instant.now()
        );
        readinessMap.put(deviceId, nextState);
        logger.info("Marked readiness STARTING (requested) for deviceId={}, requestId={}", deviceId, requestId);
        return nextState;
    }

    public DeviceReadinessState handleCalibrationEvent(String deviceId, CalibrationMqttEvent event) {
        if (deviceId == null || event == null) {
            return null;
        }

        logger.info("Received calibration event deviceId={} eventId={} progressId={} state={}",
                deviceId, event.eventId(), event.progressId(), event.firmwareState());

        if (event.eventId() == null) {
            logger.warn("Received calibration event with missing eventId for deviceId={}", deviceId);
            return getReadiness(deviceId);
        }

        if (event.eventId() != 4000 && event.eventId() != 4001 && event.eventId() != 4002) {
            logger.warn("Received calibration event with unknown eventId={} for deviceId={}", event.eventId(), deviceId);
            return getReadiness(deviceId);
        }

        DeviceReadinessState previous = getReadiness(deviceId);

        // Define state update targets
        CalibrationState calibrationState = previous.calibrationState();
        Integer currentProgressId = previous.currentProgressId();
        boolean readyForSession = previous.readyForSession();

        String statusClean = clean(event.status());
        String resultClean = clean(event.result());
        String stateClean = clean(event.firmwareState());

        // Process based on eventId
        if (event.eventId() == 4000) {
            if ("ACK".equals(statusClean)) {
                calibrationState = "CALIBRATING".equals(stateClean) ? CalibrationState.CALIBRATING : CalibrationState.STARTING;
                currentProgressId = 1;
                readyForSession = false;
            } else if ("NACK".equals(statusClean)) {
                calibrationState = CalibrationState.FAILED;
                readyForSession = false;
            }
        } else if (event.eventId() == 4001) {
            calibrationState = CalibrationState.CALIBRATING;
            if (event.progressId() != null) {
                currentProgressId = event.progressId();
                if (event.progressId() == 12) {
                    calibrationState = CalibrationState.FAILED;
                } else if (event.progressId() == 13) {
                    calibrationState = CalibrationState.INTERRUPTED;
                }
            }
            readyForSession = false;
        } else if (event.eventId() == 4002) {
            if ("PASS".equals(resultClean)) {
                calibrationState = CalibrationState.READY;
                readyForSession = true;
            } else if ("FAIL".equals(resultClean) || "NACK".equals(statusClean)) {
                calibrationState = CalibrationState.FAILED;
                readyForSession = false;
            } else if ("CANCELLED".equals(resultClean) || "CANCEL".equals(resultClean)) {
                calibrationState = CalibrationState.CANCELLED;
                readyForSession = false;
            }
        }

        // Handle field updates & defaults
        String firmwareState = event.firmwareState() != null ? event.firmwareState() : previous.firmwareState();
        
        String lastReasonId = event.reasonId() != null ? event.reasonId() : "00000";
        if (event.reasonId() == null && previous.lastReasonId() != null) {
            lastReasonId = previous.lastReasonId();
        }

        Integer lastActionId = event.actionId() != null ? event.actionId() : 0;
        if (event.actionId() == null && previous.lastActionId() != null) {
            lastActionId = previous.lastActionId();
        }

        String lastResult = event.result() != null ? event.result() : previous.lastResult();
        String lastReplyId = event.replyId() != null ? event.replyId() : previous.lastReplyId();
        Instant lastUpdatedAt = event.receivedAt() != null ? event.receivedAt() : Instant.now();

        DeviceReadinessState nextState = new DeviceReadinessState(
                deviceId,
                calibrationState,
                firmwareState,
                currentProgressId,
                lastReasonId,
                lastActionId,
                lastResult,
                lastReplyId,
                readyForSession,
                lastUpdatedAt
        );

        readinessMap.put(deviceId, nextState);
        logger.info("Updated readiness deviceId={} calibrationState={} readyForSession={}",
                deviceId, nextState.calibrationState(), nextState.readyForSession());

        return nextState;
    }

    private String clean(String str) {
        return str == null ? null : str.trim().toUpperCase(Locale.ROOT);
    }
}
