package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.JsonNode;
import lk.resq.localhub.model.firmware.CalibrationMqttEvent;
import lk.resq.localhub.model.firmware.CalibrationState;
import lk.resq.localhub.model.firmware.DeviceRuntimeState;
import lk.resq.localhub.model.firmware.RuntimeMessageApplyResult;
import lk.resq.localhub.model.firmware.RuntimeMessageDisposition;
import lk.resq.localhub.model.firmware.RuntimeOrderingConfidence;
import lk.resq.localhub.model.firmware.RuntimeStateSource;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashSet;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Pattern;

@Service
public class DeviceRuntimeStateService {

    private static final Pattern BOOT_ID_PATTERN = Pattern.compile("^[0-9a-f]{16}$");
    private static final int SUPERSEDED_BOOT_HISTORY_LIMIT = 4;

    private final ConcurrentMap<String, DeviceRuntimeState> statesByDeviceId = new ConcurrentHashMap<>();
    private final ConcurrentMap<String, Deque<String>> supersededBootIdsByDeviceId = new ConcurrentHashMap<>();

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
        return applyStatusResult(deviceId, payload).state();
    }

    public RuntimeMessageApplyResult applyStatusResult(String deviceId, JsonNode payload) {
        return applySnapshot(deviceId, payload, RuntimeStateSource.STATUS);
    }

    public DeviceRuntimeState applyHeartbeat(String deviceId, JsonNode payload) {
        return applyHeartbeatResult(deviceId, payload).state();
    }

    public RuntimeMessageApplyResult applyHeartbeatResult(String deviceId, JsonNode payload) {
        return applySnapshot(deviceId, payload, RuntimeStateSource.HEARTBEAT);
    }

    public DeviceRuntimeState applyCalibrationEvent(String deviceId, CalibrationMqttEvent event) {
        return applyCalibrationEventResult(deviceId, event).state();
    }

    public RuntimeMessageApplyResult applyCalibrationEventResult(String deviceId, CalibrationMqttEvent event) {
        String normalized = requireDeviceId(deviceId);
        if (event == null) {
            DeviceRuntimeState state = getOrCreate(normalized);
            return new RuntimeMessageApplyResult(RuntimeMessageDisposition.INVALID_ORDERING_FIELDS, state, false, state.bootId(), state.bootId());
        }

        long nowMs = nowMs();
        long incomingTs = positiveOrZero(event.tsMs());
        int incomingPrecedence = calibrationEventPrecedence(event.eventId());
        IncomingOrdering incomingOrdering = orderingFromEvent(event);
        AtomicReference<RuntimeMessageDisposition> disposition = new AtomicReference<>(RuntimeMessageDisposition.ACCEPTED);
        AtomicReference<Boolean> bootChanged = new AtomicReference<>(false);
        AtomicReference<String> previousBootId = new AtomicReference<>(null);
        AtomicReference<String> currentBootId = new AtomicReference<>(null);

        DeviceRuntimeState state = statesByDeviceId.compute(normalized, (key, previous) -> {
            DeviceRuntimeState base = previous != null ? previous : unknownState(normalized);
            OrderingDecision orderingDecision = decideOrdering(normalized, base, incomingOrdering);
            disposition.set(orderingDecision.disposition());
            bootChanged.set(orderingDecision.bootChanged());
            previousBootId.set(orderingDecision.previousBootId());
            currentBootId.set(orderingDecision.currentBootId());
            if (!orderingDecision.acceptDomainMutation()) {
                return withLastSeen(base, nowMs);
            }
            if (!orderingDecision.bootChanged() && shouldKeepPrevious(base, incomingTs, incomingPrecedence)) {
                disposition.set(incomingOrdering.confidence() == RuntimeOrderingConfidence.SEQUENCED
                        ? RuntimeMessageDisposition.STALE_SEQUENCE
                        : RuntimeMessageDisposition.LEGACY_IGNORED);
                return withLastSeen(base, nowMs);
            }

            String firmwareState = normalizeState(event.firmwareState());
            String calibrationState = base.calibrationState();
            String lastResult = firstNonBlank(event.result(), base.lastCalibrationResult());
            boolean calibrated = base.calibrated();
            String readinessReason = base.readinessReason();
            String calibrationStorageStatus = base.calibrationStorageStatus();
            Boolean recalibrationRequired = base.recalibrationRequired();
            Integer profileVersion = base.profileVersion();
            String profileHash = base.profileHash();

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
                    calibrationStorageStatus = "VALID";
                    recalibrationRequired = false;
                    if (profileVersion == null) {
                        profileVersion = 1;
                    }
                    if (profileHash == null) {
                        profileHash = "0000000000000000000000000000000000000000000000000000000000000000";
                    }
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
                    calibrationStorageStatus = "INVALID";
                    recalibrationRequired = true;
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

            String profileId = firstNonBlank(event.profileId(), base.calibrationProfileId());

            boolean sessionActive = deriveSessionActive(firmwareState, base.sessionActive(), null);
            boolean readyForSession = deriveReadyForSessionStrict(
                    firmwareState, calibrated, sessionActive,
                    calibrationStorageStatus, recalibrationRequired,
                    profileId,
                    profileVersion, profileHash
            );
            readinessReason = deriveReadinessReason(firmwareState, calibrated, sessionActive, readyForSession, readinessReason);

            DeviceRuntimeState updated = new DeviceRuntimeState(
                    normalized,
                    firmwareState,
                    calibrated,
                    readyForSession,
                    calibrationState,
                    lastResult,
                    profileId,
                    base.sessionId(),
                    sessionActive,
                    acceptedTimestamp(base, incomingTs),
                    nowMs,
                    RuntimeStateSource.CALIBRATION_EVENT,
                    readinessReason,
                    resolvedProgressId(event, base),
                    event.reasonId() != null ? event.reasonId() : (base.lastReasonId() != null ? base.lastReasonId() : "00000"),
                    event.actionId() != null ? event.actionId() : (base.lastActionId() != null ? base.lastActionId() : 0),
                    event.replyId() != null ? event.replyId() : base.lastReplyId(),
                    null, // bootId
                    null, // stateSeq
                    RuntimeOrderingConfidence.UNKNOWN, // orderingConfidence
                    base.calibrationSchemaVersion(),
                    base.calibrationGeneration(),
                    calibrationStorageStatus,
                    recalibrationRequired,
                    profileVersion,
                    profileHash
            );
            return withOrdering(updated, orderingDecision.acceptedBootId(), orderingDecision.acceptedStateSeq(), incomingOrdering.confidence());
        });
        return new RuntimeMessageApplyResult(disposition.get(), state, bootChanged.get(), previousBootId.get(), currentBootId.get());
    }

    public DeviceRuntimeState markCalibrationStartRequested(String deviceId, String requestId) {
        String normalized = requireDeviceId(deviceId);
        long nowMs = nowMs();
        return statesByDeviceId.compute(normalized, (key, previous) -> {
            DeviceRuntimeState base = previous != null ? previous : unknownState(normalized);
            DeviceRuntimeState updated = new DeviceRuntimeState(
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
                    requestId != null ? requestId : base.lastReplyId(),
                    null, // bootId
                    null, // stateSeq
                    RuntimeOrderingConfidence.UNKNOWN, // orderingConfidence
                    base.calibrationSchemaVersion(),
                    base.calibrationGeneration(),
                    base.calibrationStorageStatus(),
                    base.recalibrationRequired(),
                    base.profileVersion(),
                    base.profileHash()
            );
            return withOrdering(updated, base.bootId(), base.stateSeq(), base.orderingConfidence());
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

    private RuntimeMessageApplyResult applySnapshot(String deviceId, JsonNode payload, RuntimeStateSource source) {
        String normalized = requireDeviceId(deviceId);
        long nowMs = nowMs();
        long incomingTs = positiveOrZero(longValue(payload, "ts_ms", "tsMs"));
        int incomingPrecedence = sourcePrecedence(source, null);
        IncomingOrdering incomingOrdering = orderingFromPayload(payload);
        AtomicReference<RuntimeMessageDisposition> disposition = new AtomicReference<>(RuntimeMessageDisposition.ACCEPTED);
        AtomicReference<Boolean> bootChanged = new AtomicReference<>(false);
        AtomicReference<String> previousBootId = new AtomicReference<>(null);
        AtomicReference<String> currentBootId = new AtomicReference<>(null);

        DeviceRuntimeState state = statesByDeviceId.compute(normalized, (key, previous) -> {
            DeviceRuntimeState base = previous != null ? previous : unknownState(normalized);
            OrderingDecision orderingDecision = decideOrdering(normalized, base, incomingOrdering);
            disposition.set(orderingDecision.disposition());
            bootChanged.set(orderingDecision.bootChanged());
            previousBootId.set(orderingDecision.previousBootId());
            currentBootId.set(orderingDecision.currentBootId());
            if (!orderingDecision.acceptDomainMutation()) {
                return withLastSeen(base, nowMs);
            }
            if (!orderingDecision.bootChanged() && shouldKeepPrevious(base, incomingTs, incomingPrecedence)) {
                disposition.set(incomingOrdering.confidence() == RuntimeOrderingConfidence.SEQUENCED
                        ? RuntimeMessageDisposition.STALE_SEQUENCE
                        : RuntimeMessageDisposition.LEGACY_IGNORED);
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

            Integer calibrationSchemaVersion = integerValue(payload, "calibrationSchemaVersion", "calibration_schema_version");
            if (calibrationSchemaVersion == null) {
                calibrationSchemaVersion = base.calibrationSchemaVersion();
            }

            Integer calibrationGeneration = integerValue(payload, "calibrationGeneration", "calibration_generation");
            if (calibrationGeneration == null) {
                calibrationGeneration = base.calibrationGeneration();
            }

            String calibrationStorageStatus = firstText(payload, "calibrationStorageStatus", "calibration_storage_status");
            if (calibrationStorageStatus == null) {
                calibrationStorageStatus = base.calibrationStorageStatus();
            }
            if (calibrated && (calibrationStorageStatus == null || "UNKNOWN".equalsIgnoreCase(calibrationStorageStatus))) {
                calibrationStorageStatus = "VALID";
            }

            Boolean recalibrationRequired = booleanValue(payload, "recalibrationRequired", "recalibration_required");
            if (recalibrationRequired == null) {
                recalibrationRequired = base.recalibrationRequired();
            }
            if (calibrated && recalibrationRequired == null) {
                recalibrationRequired = false;
            }

            Integer profileVersion = integerValue(payload, "profileVersion", "profile_version");
            if (profileVersion == null) {
                profileVersion = base.profileVersion();
            }
            if (calibrated && profileVersion == null) {
                profileVersion = 1;
            }

            String profileHash = firstText(payload, "profileHash", "profile_hash");
            if (profileHash == null) {
                profileHash = base.profileHash();
            }
            if (calibrated && profileHash == null) {
                profileHash = "0000000000000000000000000000000000000000000000000000000000000000";
            }

            boolean readyForSession = deriveReadyForSessionStrict(
                    firmwareState, calibrated, sessionActive,
                    calibrationStorageStatus, recalibrationRequired,
                    profileId, profileVersion, profileHash
            );

            DeviceRuntimeState updated = new DeviceRuntimeState(
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
                    base.lastReplyId(),
                    null, // bootId
                    null, // stateSeq
                    RuntimeOrderingConfidence.UNKNOWN, // orderingConfidence
                    calibrationSchemaVersion,
                    calibrationGeneration,
                    calibrationStorageStatus,
                    recalibrationRequired,
                    profileVersion,
                    profileHash
            );
            return withOrdering(updated, orderingDecision.acceptedBootId(), orderingDecision.acceptedStateSeq(), incomingOrdering.confidence());
        });
        return new RuntimeMessageApplyResult(disposition.get(), state, bootChanged.get(), previousBootId.get(), currentBootId.get());
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
                null,
                null, // bootId
                null, // stateSeq
                RuntimeOrderingConfidence.UNKNOWN, // orderingConfidence
                0, // calibrationSchemaVersion
                0, // calibrationGeneration
                "UNKNOWN", // calibrationStorageStatus
                null, // recalibrationRequired
                null, // profileVersion
                null // profileHash
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
                state.lastReplyId(),
                state.bootId(),
                state.stateSeq(),
                state.orderingConfidence(),
                state.calibrationSchemaVersion(),
                state.calibrationGeneration(),
                state.calibrationStorageStatus(),
                state.recalibrationRequired(),
                state.profileVersion(),
                state.profileHash()
        );
    }

    private DeviceRuntimeState withOrdering(
            DeviceRuntimeState state,
            String bootId,
            Long stateSeq,
            RuntimeOrderingConfidence confidence
    ) {
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
                state.lastSeenEpochMs(),
                state.lastSource(),
                state.readinessReason(),
                state.currentProgressId(),
                state.lastReasonId(),
                state.lastActionId(),
                state.lastReplyId(),
                bootId,
                stateSeq,
                confidence,
                state.calibrationSchemaVersion(),
                state.calibrationGeneration(),
                state.calibrationStorageStatus(),
                state.recalibrationRequired(),
                state.profileVersion(),
                state.profileHash()
        );
    }

    private OrderingDecision decideOrdering(String deviceId, DeviceRuntimeState base, IncomingOrdering incoming) {
        if (incoming.disposition() == RuntimeMessageDisposition.INVALID_ORDERING_FIELDS) {
            return OrderingDecision.reject(RuntimeMessageDisposition.INVALID_ORDERING_FIELDS, base.bootId(), base.bootId());
        }

        if (incoming.confidence() == RuntimeOrderingConfidence.LEGACY) {
            if (base.orderingConfidence() == RuntimeOrderingConfidence.SEQUENCED && base.bootId() != null) {
                return OrderingDecision.reject(RuntimeMessageDisposition.LEGACY_IGNORED, base.bootId(), base.bootId());
            }
            return OrderingDecision.accept(RuntimeMessageDisposition.LEGACY_ACCEPTED, false, null, base.bootId(), base.bootId(), base.stateSeq());
        }

        String incomingBootId = incoming.bootId();
        Long incomingStateSeq = incoming.stateSeq();
        if (incomingBootId == null || incomingStateSeq == null) {
            return OrderingDecision.reject(RuntimeMessageDisposition.INVALID_ORDERING_FIELDS, base.bootId(), base.bootId());
        }

        if (isSupersededBoot(deviceId, incomingBootId)) {
            return OrderingDecision.reject(RuntimeMessageDisposition.SUPERSEDED_BOOT, base.bootId(), base.bootId());
        }

        if (base.bootId() == null) {
            return OrderingDecision.accept(RuntimeMessageDisposition.ACCEPTED, false, null, incomingBootId, incomingBootId, incomingStateSeq);
        }

        if (incomingBootId.equals(base.bootId())) {
            long previousSeq = base.stateSeq() == null ? 0L : base.stateSeq();
            if (incomingStateSeq > previousSeq) {
                return OrderingDecision.accept(RuntimeMessageDisposition.ACCEPTED, false, base.bootId(), incomingBootId, incomingBootId, incomingStateSeq);
            }
            if (incomingStateSeq == previousSeq) {
                return OrderingDecision.reject(RuntimeMessageDisposition.DUPLICATE, base.bootId(), base.bootId());
            }
            return OrderingDecision.reject(RuntimeMessageDisposition.STALE_SEQUENCE, base.bootId(), base.bootId());
        }

        recordSupersededBoot(deviceId, base.bootId());
        return OrderingDecision.accept(RuntimeMessageDisposition.ACCEPTED, true, base.bootId(), incomingBootId, incomingBootId, incomingStateSeq);
    }

    private boolean isSupersededBoot(String deviceId, String bootId) {
        Deque<String> boots = supersededBootIdsByDeviceId.get(deviceId);
        return boots != null && boots.contains(bootId);
    }

    private void recordSupersededBoot(String deviceId, String bootId) {
        if (bootId == null || bootId.isBlank()) {
            return;
        }
        supersededBootIdsByDeviceId.compute(deviceId, (key, existing) -> {
            Deque<String> boots = existing != null ? existing : new ArrayDeque<>();
            boots.remove(bootId);
            boots.addFirst(bootId);
            while (boots.size() > SUPERSEDED_BOOT_HISTORY_LIMIT) {
                boots.removeLast();
            }
            return boots;
        });
    }

    private static IncomingOrdering orderingFromPayload(JsonNode payload) {
        boolean hasBootId = hasAny(payload, "boot_id", "bootId");
        boolean hasStateSeq = hasAny(payload, "state_seq", "stateSeq");
        if (!hasBootId && !hasStateSeq) {
            return IncomingOrdering.legacy();
        }
        String bootId = firstText(payload, "boot_id", "bootId");
        Long stateSeq = unsignedIntValue(payload, "state_seq", "stateSeq");
        if (!validBootId(bootId) || stateSeq == null) {
            return IncomingOrdering.invalid();
        }
        return IncomingOrdering.sequenced(bootId, stateSeq);
    }

    private static IncomingOrdering orderingFromEvent(CalibrationMqttEvent event) {
        if (event.bootId() == null && event.stateSeq() == null) {
            return IncomingOrdering.legacy();
        }
        if (!validBootId(event.bootId()) || event.stateSeq() == null
                || event.stateSeq() < 1L || event.stateSeq() > 4294967295L) {
            return IncomingOrdering.invalid();
        }
        return IncomingOrdering.sequenced(event.bootId(), event.stateSeq());
    }

    private static boolean validBootId(String bootId) {
        return bootId != null && BOOT_ID_PATTERN.matcher(bootId).matches();
    }

    private static long acceptedTimestamp(DeviceRuntimeState previous, long incomingTs) {
        return incomingTs > 0 ? incomingTs : previous.firmwareTimestampMs();
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
        if (!"READY_FOR_SESSION".equals(normalizeState(firmwareState))) return false;
        if (!calibrated) return false;
        if (sessionActive) return false;

        // Legacy fallback: if ALL Phase 8 metadata fields are absent this is a pre-Phase-8
        // device report. Fall back to simple readiness (READY_FOR_SESSION + calibrated + !session).
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
        // When firmware reports the sentinel hash it has no real Phase 8 profile identity
        // (legacy firmware or freshly started calibration) — skip the profile identity checks.
        boolean isSentinel = SENTINEL_HASH.equals(profileHash == null ? null : profileHash.trim());
        if (!isSentinel) {
            if (profileId == null || profileId.trim().isEmpty()) return false;
            if (profileVersion == null || profileVersion <= 0) return false;
            if (profileHash.trim().length() != 64 || !profileHash.trim().matches("^[0-9a-fA-F]{64}$")) return false;
        }
        return true;
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

    private static Integer integerValue(JsonNode payload, String... keys) {
        Long val = longValue(payload, keys);
        return val == null ? null : val.intValue();
    }

    private static Long unsignedIntValue(JsonNode payload, String... keys) {
        Long value = longValue(payload, keys);
        return value != null && value >= 1L && value <= 4294967295L ? value : null;
    }

    private record IncomingOrdering(
            RuntimeOrderingConfidence confidence,
            String bootId,
            Long stateSeq,
            RuntimeMessageDisposition disposition
    ) {
        static IncomingOrdering sequenced(String bootId, Long stateSeq) {
            return new IncomingOrdering(RuntimeOrderingConfidence.SEQUENCED, bootId, stateSeq, RuntimeMessageDisposition.ACCEPTED);
        }

        static IncomingOrdering legacy() {
            return new IncomingOrdering(RuntimeOrderingConfidence.LEGACY, null, null, RuntimeMessageDisposition.LEGACY_ACCEPTED);
        }

        static IncomingOrdering invalid() {
            return new IncomingOrdering(RuntimeOrderingConfidence.UNKNOWN, null, null, RuntimeMessageDisposition.INVALID_ORDERING_FIELDS);
        }
    }

    private record OrderingDecision(
            RuntimeMessageDisposition disposition,
            boolean acceptDomainMutation,
            boolean bootChanged,
            String previousBootId,
            String currentBootId,
            String acceptedBootId,
            Long acceptedStateSeq
    ) {
        static OrderingDecision accept(
                RuntimeMessageDisposition disposition,
                boolean bootChanged,
                String previousBootId,
                String currentBootId,
                String acceptedBootId,
                Long acceptedStateSeq
        ) {
            return new OrderingDecision(disposition, true, bootChanged, previousBootId, currentBootId, acceptedBootId, acceptedStateSeq);
        }

        static OrderingDecision reject(RuntimeMessageDisposition disposition, String previousBootId, String currentBootId) {
            return new OrderingDecision(disposition, false, false, previousBootId, currentBootId, currentBootId, null);
        }
    }
}
