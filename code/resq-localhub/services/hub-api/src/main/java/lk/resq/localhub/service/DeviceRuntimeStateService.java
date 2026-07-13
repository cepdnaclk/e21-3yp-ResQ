package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.JsonNode;
import lk.resq.localhub.model.firmware.CalibrationMqttEvent;
import lk.resq.localhub.model.firmware.CalibrationState;
import lk.resq.localhub.model.firmware.DeviceRuntimeState;
import lk.resq.localhub.model.firmware.RuntimeStateSource;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Locale;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

@Service
public class DeviceRuntimeStateService {

    private final ConcurrentMap<String, DeviceRuntimeState> statesByDeviceId = new ConcurrentHashMap<>();

    public Optional<DeviceRuntimeState> find(String deviceId) {
        String normalized = normalizeDeviceIdOrNull(deviceId);
        if (normalized == null) {
            return Optional.empty();
        }
        return Optional.ofNullable(statesByDeviceId.get(normalized));
    }

    public DeviceRuntimeState getOrCreate(String deviceId) {
        String normalized = requireDeviceId(deviceId);
        return statesByDeviceId.computeIfAbsent(normalized, DeviceRuntimeStateService::unknownState);
    }

    public DeviceRuntimeState applyStatus(String deviceId, JsonNode payload) {
        return applySnapshot(deviceId, payload, RuntimeStateSource.STATUS);
    }

    public DeviceRuntimeState applyHeartbeat(String deviceId, JsonNode payload) {
        return applySnapshot(deviceId, payload, RuntimeStateSource.HEARTBEAT);
    }

    public DeviceRuntimeState applyCalibrationEvent(String deviceId, CalibrationMqttEvent event) {
        String normalized = requireDeviceId(deviceId);
        if (event == null) {
            return getOrCreate(normalized);
        }

        long nowMs = nowMs();
        long incomingTs = positiveOrZero(event.tsMs());
        int incomingPrecedence = calibrationEventPrecedence(event.eventId());

        return statesByDeviceId.compute(normalized, (key, previous) -> {
            DeviceRuntimeState base = previous != null ? previous : unknownState(normalized);
            if (shouldKeepPrevious(base, incomingTs, incomingPrecedence)) {
                return withLastSeen(base, nowMs);
            }

            String firmwareState = normalizeState(event.firmwareState());
            String calibrationState = base.calibrationState();
            String lastResult = firstNonBlank(event.result(), base.lastCalibrationResult());
            boolean calibrated = base.calibrated();
            String readinessReason = base.readinessReason();

            String status = clean(event.status());
            String result = clean(event.result());

            if (Integer.valueOf(4000).equals(event.eventId())) {
                if ("ACK".equals(status)) {
                    calibrationState = "CALIBRATING".equals(firmwareState) ? CalibrationState.CALIBRATING.name() : CalibrationState.STARTING.name();
                    if (firmwareState == null) {
                        firmwareState = base.firmwareState();
                    }
                    readinessReason = "CALIBRATION_IN_PROGRESS";
                } else if ("NACK".equals(status)) {
                    calibrationState = CalibrationState.FAILED.name();
                    calibrated = false;
                    readinessReason = "CALIBRATION_COMMAND_REJECTED";
                }
            } else if (Integer.valueOf(4001).equals(event.eventId())) {
                calibrationState = CalibrationState.CALIBRATING.name();
                if (Integer.valueOf(12).equals(event.progressId())) {
                    calibrationState = CalibrationState.FAILED.name();
                    calibrated = false;
                } else if (Integer.valueOf(13).equals(event.progressId())) {
                    calibrationState = CalibrationState.INTERRUPTED.name();
                    calibrated = false;
                }
                if (firmwareState == null) {
                    firmwareState = "CALIBRATING";
                }
                readinessReason = "CALIBRATION_IN_PROGRESS";
            } else if (Integer.valueOf(4002).equals(event.eventId())) {
                if ("PASS".equals(result) || "PASS_WITH_WARNINGS".equals(result)) {
                    calibrationState = CalibrationState.READY.name();
                    calibrated = true;
                    if ("READY_FOR_SESSION".equals(firmwareState)) {
                        readinessReason = "READY";
                    } else if (firmwareState == null) {
                        firmwareState = base.firmwareState();
                        readinessReason = "FIRMWARE_STATE_NOT_READY";
                    } else {
                        readinessReason = "FIRMWARE_STATE_NOT_READY";
                    }
                } else if ("FAIL".equals(result) || "NACK".equals(status)) {
                    calibrationState = CalibrationState.FAILED.name();
                    calibrated = false;
                    if (firmwareState == null) {
                        firmwareState = "CALIBRATION_FAIL";
                    }
                    readinessReason = "CALIBRATION_FAILED";
                } else if ("CANCELLED".equals(result) || "CANCELED".equals(result) || "CANCEL".equals(result)) {
                    calibrationState = CalibrationState.CANCELLED.name();
                    calibrated = false;
                    readinessReason = "CALIBRATION_CANCELLED";
                }
            }

            if (firmwareState == null) {
                firmwareState = base.firmwareState();
            }

            boolean sessionActive = deriveSessionActive(firmwareState, base.sessionActive(), null);
            boolean readyForSession = deriveReadyForSession(firmwareState, calibrated, sessionActive);
            readinessReason = deriveReadinessReason(firmwareState, calibrated, sessionActive, readyForSession, readinessReason);

            return new DeviceRuntimeState(
                    normalized,
                    firmwareState,
                    calibrated,
                    readyForSession,
                    calibrationState,
                    lastResult,
                    firstNonBlank(event.profileId(), base.calibrationProfileId()),
                    base.sessionId(),
                    sessionActive,
                    acceptedTimestamp(base, incomingTs),
                    nowMs,
                    RuntimeStateSource.CALIBRATION_EVENT,
                    readinessReason,
                    resolvedProgressId(event, base),
                    event.reasonId() != null ? event.reasonId() : (base.lastReasonId() != null ? base.lastReasonId() : "00000"),
                    event.actionId() != null ? event.actionId() : (base.lastActionId() != null ? base.lastActionId() : 0),
                    event.replyId() != null ? event.replyId() : base.lastReplyId()
            );
        });
    }

    public DeviceRuntimeState markCalibrationStartRequested(String deviceId, String requestId) {
        String normalized = requireDeviceId(deviceId);
        long nowMs = nowMs();
        return statesByDeviceId.compute(normalized, (key, previous) -> {
            DeviceRuntimeState base = previous != null ? previous : unknownState(normalized);
            return new DeviceRuntimeState(
                    normalized,
                    base.firmwareState(),
                    base.calibrated(),
                    false,
                    CalibrationState.STARTING.name(),
                    base.lastCalibrationResult(),
                    base.calibrationProfileId(),
                    base.sessionId(),
                    base.sessionActive(),
                    base.firmwareTimestampMs(),
                    nowMs,
                    RuntimeStateSource.CALIBRATION_EVENT,
                    "CALIBRATION_IN_PROGRESS",
                    1,
                    base.lastReasonId(),
                    base.lastActionId(),
                    requestId != null ? requestId : base.lastReplyId()
            );
        });
    }

    public boolean isReadyForSession(String deviceId) {
        return find(deviceId).map(DeviceRuntimeState::readyForSession).orElse(false);
    }

    public void clear(String deviceId) {
        String normalized = normalizeDeviceIdOrNull(deviceId);
        if (normalized != null) {
            statesByDeviceId.remove(normalized);
        }
    }

    private DeviceRuntimeState applySnapshot(String deviceId, JsonNode payload, RuntimeStateSource source) {
        String normalized = requireDeviceId(deviceId);
        long nowMs = nowMs();
        long incomingTs = positiveOrZero(longValue(payload, "ts_ms", "tsMs"));
        int incomingPrecedence = sourcePrecedence(source, null);

        return statesByDeviceId.compute(normalized, (key, previous) -> {
            DeviceRuntimeState base = previous != null ? previous : unknownState(normalized);
            if (shouldKeepPrevious(base, incomingTs, incomingPrecedence)) {
                return withLastSeen(base, nowMs);
            }

            String incomingState = normalizeState(firstText(payload, "state", "status", "firmwareState", "firmware_state"));
            String firmwareState = incomingState != null ? incomingState : base.firmwareState();
            Boolean explicitCalibrated = booleanValue(payload, "calibrated");
            boolean calibrated = explicitCalibrated != null ? explicitCalibrated : base.calibrated();
            Boolean explicitSessionActive = booleanValue(payload, "sessionActive", "session_active");
            boolean sessionActive = deriveSessionActive(firmwareState, base.sessionActive(), explicitSessionActive);

            if ("READY_FOR_SESSION".equals(firmwareState) && explicitCalibrated == null) {
                calibrated = true;
            } else if ("CALIBRATION_FAIL".equals(firmwareState) || "SESSION_INTERRUPTED".equals(firmwareState)) {
                calibrated = false;
            }

            String calibrationState = deriveCalibrationState(firmwareState, base.calibrationState(), calibrated);
            String sessionId = normalize(firstText(payload, "sessionId", "session_id"));
            if (sessionId == null && hasAny(payload, "sessionId", "session_id")) {
                sessionId = null;
            } else if (sessionId == null) {
                sessionId = base.sessionId();
            }

            String profileId = firstNonBlank(firstText(payload, "profileId", "profile_id"), base.calibrationProfileId());
            boolean readyForSession = deriveReadyForSession(firmwareState, calibrated, sessionActive);

            return new DeviceRuntimeState(
                    normalized,
                    firmwareState,
                    calibrated,
                    readyForSession,
                    calibrationState,
                    base.lastCalibrationResult(),
                    profileId,
                    sessionId,
                    sessionActive,
                    acceptedTimestamp(base, incomingTs),
                    nowMs,
                    source,
                    deriveReadinessReason(firmwareState, calibrated, sessionActive, readyForSession, null),
                    base.currentProgressId(),
                    base.lastReasonId(),
                    base.lastActionId(),
                    base.lastReplyId()
            );
        });
    }

    private static boolean shouldKeepPrevious(DeviceRuntimeState previous, long incomingTs, int incomingPrecedence) {
        if (previous == null || previous.firmwareTimestampMs() <= 0 || incomingTs <= 0) {
            return false;
        }
        if (incomingTs < previous.firmwareTimestampMs()) {
            return true;
        }
        return incomingTs == previous.firmwareTimestampMs() && incomingPrecedence < statePrecedence(previous);
    }

    private static int statePrecedence(DeviceRuntimeState state) {
        if (state.lastSource() == RuntimeStateSource.CALIBRATION_EVENT) {
            String calibrationState = clean(state.calibrationState());
            if ("READY".equals(calibrationState) || "FAILED".equals(calibrationState) || "CANCELLED".equals(calibrationState)) {
                return 40;
            }
            if ("CALIBRATING".equals(calibrationState)) {
                return 20;
            }
            return 10;
        }
        return sourcePrecedence(state.lastSource(), null);
    }

    private static int calibrationEventPrecedence(Integer eventId) {
        if (Integer.valueOf(4002).equals(eventId)) {
            return 40;
        }
        if (Integer.valueOf(4001).equals(eventId)) {
            return 20;
        }
        return 10;
    }

    private static Integer resolvedProgressId(CalibrationMqttEvent event, DeviceRuntimeState base) {
        if (event.progressId() != null) {
            return event.progressId();
        }
        if (Integer.valueOf(4000).equals(event.eventId()) && "ACK".equals(clean(event.status()))) {
            return 1;
        }
        return base.currentProgressId();
    }

    private static int sourcePrecedence(RuntimeStateSource source, Integer eventId) {
        if (source == RuntimeStateSource.STATUS) {
            return 50;
        }
        if (source == RuntimeStateSource.CALIBRATION_EVENT) {
            return calibrationEventPrecedence(eventId);
        }
        if (source == RuntimeStateSource.HEARTBEAT) {
            return 30;
        }
        if (source == RuntimeStateSource.SESSION_EVENT) {
            return 25;
        }
        if (source == RuntimeStateSource.REGISTRATION) {
            return 5;
        }
        return 0;
    }

    private static DeviceRuntimeState unknownState(String deviceId) {
        long nowMs = nowMs();
        return new DeviceRuntimeState(
                deviceId,
                null,
                false,
                false,
                CalibrationState.UNKNOWN.name(),
                null,
                null,
                null,
                false,
                0L,
                nowMs,
                RuntimeStateSource.UNKNOWN,
                "UNKNOWN_FIRMWARE_STATE",
                null,
                null,
                null,
                null
        );
    }

    private static DeviceRuntimeState withLastSeen(DeviceRuntimeState state, long lastSeenEpochMs) {
        return new DeviceRuntimeState(
                state.deviceId(),
                state.firmwareState(),
                state.calibrated(),
                state.readyForSession(),
                state.calibrationState(),
                state.lastCalibrationResult(),
                state.calibrationProfileId(),
                state.sessionId(),
                state.sessionActive(),
                state.firmwareTimestampMs(),
                lastSeenEpochMs,
                state.lastSource(),
                state.readinessReason(),
                state.currentProgressId(),
                state.lastReasonId(),
                state.lastActionId(),
                state.lastReplyId()
        );
    }

    private static long acceptedTimestamp(DeviceRuntimeState previous, long incomingTs) {
        return incomingTs > 0 ? incomingTs : previous.firmwareTimestampMs();
    }

    private static boolean deriveReadyForSession(String firmwareState, boolean calibrated, boolean sessionActive) {
        return "READY_FOR_SESSION".equals(normalizeState(firmwareState)) && calibrated && !sessionActive;
    }

    private static boolean deriveSessionActive(String firmwareState, boolean previous, Boolean explicit) {
        String normalizedState = normalizeState(firmwareState);
        if ("SESSION_ACTIVE".equals(normalizedState)) {
            return true;
        }
        if ("SESSION_INTERRUPTED".equals(normalizedState) || "PAIRED_IDLE".equals(normalizedState) || "READY_FOR_SESSION".equals(normalizedState)) {
            return false;
        }
        return explicit != null ? explicit : previous;
    }

    private static String deriveCalibrationState(String firmwareState, String previous, boolean calibrated) {
        String normalizedState = normalizeState(firmwareState);
        if ("READY_FOR_SESSION".equals(normalizedState)) {
            return CalibrationState.READY.name();
        }
        if ("CALIBRATING".equals(normalizedState)) {
            return CalibrationState.CALIBRATING.name();
        }
        if ("CALIBRATION_FAIL".equals(normalizedState)) {
            return CalibrationState.FAILED.name();
        }
        if ("PAIRED_IDLE".equals(normalizedState)) {
            return calibrated ? CalibrationState.READY.name() : CalibrationState.NOT_READY.name();
        }
        if ("SESSION_INTERRUPTED".equals(normalizedState)) {
            return CalibrationState.INTERRUPTED.name();
        }
        return previous != null ? previous : CalibrationState.UNKNOWN.name();
    }

    private static String deriveReadinessReason(String firmwareState, boolean calibrated, boolean sessionActive, boolean ready, String fallback) {
        if (ready) {
            return "READY";
        }
        String normalizedState = normalizeState(firmwareState);
        if (sessionActive || "SESSION_ACTIVE".equals(normalizedState)) {
            return "SESSION_ACTIVE";
        }
        if ("CALIBRATING".equals(normalizedState)) {
            return "CALIBRATION_IN_PROGRESS";
        }
        if ("CALIBRATION_FAIL".equals(normalizedState)) {
            return "CALIBRATION_FAILED";
        }
        if ("SESSION_INTERRUPTED".equals(normalizedState)) {
            return "SESSION_INTERRUPTED";
        }
        if (normalizedState == null) {
            return fallback != null ? fallback : "UNKNOWN_FIRMWARE_STATE";
        }
        if (!calibrated && "READY_FOR_SESSION".equals(normalizedState)) {
            return "CALIBRATION_REQUIRED";
        }
        return fallback != null ? fallback : "FIRMWARE_STATE_NOT_READY";
    }

    private static String requireDeviceId(String deviceId) {
        String normalized = normalizeDeviceIdOrNull(deviceId);
        if (normalized == null) {
            throw new IllegalArgumentException("deviceId must not be blank");
        }
        return normalized;
    }

    private static String normalizeDeviceIdOrNull(String deviceId) {
        return normalize(deviceId);
    }

    private static String normalizeState(String value) {
        String normalized = normalize(value);
        return normalized == null ? null : normalized.toUpperCase(Locale.ROOT);
    }

    private static String normalize(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static String clean(String value) {
        String normalized = normalize(value);
        return normalized == null ? null : normalized.toUpperCase(Locale.ROOT);
    }

    private static String firstNonBlank(String first, String second) {
        String normalizedFirst = normalize(first);
        return normalizedFirst != null ? normalizedFirst : normalize(second);
    }

    private static long nowMs() {
        return Instant.now().toEpochMilli();
    }

    private static long positiveOrZero(Long value) {
        return value != null && value > 0 ? value : 0L;
    }

    private static boolean hasAny(JsonNode payload, String... keys) {
        if (payload == null) {
            return false;
        }
        for (String key : keys) {
            if (payload.has(key)) {
                return true;
            }
        }
        return false;
    }

    private static String firstText(JsonNode payload, String... keys) {
        if (payload == null) {
            return null;
        }
        for (String key : keys) {
            JsonNode node = payload.get(key);
            if (node == null || node.isNull()) {
                continue;
            }
            String value = node.asText().trim();
            if (!value.isEmpty()) {
                return value;
            }
        }
        return null;
    }

    private static Boolean booleanValue(JsonNode payload, String... keys) {
        if (payload == null) {
            return null;
        }
        for (String key : keys) {
            JsonNode node = payload.get(key);
            if (node == null || node.isNull()) {
                continue;
            }
            if (node.isBoolean()) {
                return node.asBoolean();
            }
            if (node.isTextual()) {
                String value = node.asText().trim();
                if ("true".equalsIgnoreCase(value)) {
                    return true;
                }
                if ("false".equalsIgnoreCase(value)) {
                    return false;
                }
            }
        }
        return null;
    }

    private static Long longValue(JsonNode payload, String... keys) {
        if (payload == null) {
            return null;
        }
        for (String key : keys) {
            JsonNode node = payload.get(key);
            if (node == null || node.isNull()) {
                continue;
            }
            if (node.isNumber()) {
                return node.asLong();
            }
            if (node.isTextual()) {
                try {
                    return Long.parseLong(node.asText().trim());
                } catch (NumberFormatException ignored) {
                }
            }
        }
        return null;
    }
}
