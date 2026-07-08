package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.JsonNode;
import lk.resq.localhub.model.LiveMetricPayload;
import lk.resq.localhub.model.ManikinLiveSummary;
import lk.resq.localhub.model.SessionLiveView;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.function.Consumer;

@Service
public class ManikinRegistryService {

    private final Duration staleAfter;
    private final ConcurrentMap<String, MutableManikinState> registry = new ConcurrentHashMap<>();
    private final ConcurrentMap<String, MutableManikinState> registryBySessionId = new ConcurrentHashMap<>();

    public ManikinRegistryService(@Value("${resq.live.stale-after-seconds:12}") long staleAfterSeconds) {
        this.staleAfter = Duration.ofSeconds(Math.max(1L, staleAfterSeconds));
    }

    public void updateFromStatus(String deviceId, JsonNode payload) {
        upsert(deviceId, state -> {
            state.lastSeen = Instant.now();
            state.online = true;
            state.manikinId = firstTextWithFallback(payload, state.manikinId, "manikinId", "manikin_id", "deviceId", "device_id");
            state.sessionId = firstTextWithFallback(payload, state.sessionId, "sessionId", "session_id");
            state.state = canonicalFirmwareState(firstTextWithFallback(payload, state.state, "state", "status", "firmwareState", "firmware_state"));
            state.ip = firstTextWithFallback(payload, state.ip, "ip", "ipAddress", "ip_address");
            state.fw = firstTextWithFallback(payload, state.fw, "fw", "firmware", "firmwareVersion", "firmware_version");
            state.sessionActive = firstBoolean(payload, state.sessionActive, "sessionActive", "session_active");
            state.calibrated = firstBoolean(payload, state.calibrated, "calibrated");
            state.readyForSession = firstBoolean(payload, state.readyForSession, "readyForSession", "ready_for_session", "ready");
            state.profileId = firstTextWithFallback(payload, state.profileId, "profileId", "profile_id");
            updatePressureModeFields(state, payload);
            indexSession(state);
        });
    }

    public void seedFromRegistration(String deviceId, lk.resq.localhub.model.DeviceRegistrationRequest request) {
        upsert(deviceId, state -> {
            state.lastSeen = Instant.now();
            state.online = true;
            state.state = "ONLINE";
            state.fw = firstText(request == null ? null : request.firmwareVersion(), state.fw);
        });
    }

    public void updateFromHeartbeat(String deviceId, JsonNode payload) {
        upsert(deviceId, state -> {
            state.lastSeen = Instant.now();
            state.online = true;
            state.manikinId = firstTextWithFallback(payload, state.manikinId, "manikinId", "manikin_id");
            state.sessionId = firstTextWithFallback(payload, state.sessionId, "sessionId", "session_id");
            state.state = canonicalFirmwareState(firstTextWithFallback(payload, state.state, "state", "status", "firmwareState", "firmware_state"));
            state.ip = firstTextWithFallback(payload, state.ip, "ip", "ipAddress", "ip_address");
            state.fw = firstTextWithFallback(payload, state.fw, "fw", "firmware", "firmwareVersion", "firmware_version");
            state.rssi = firstInt(payload, "rssi", state.rssi);
            state.battery = firstInt(payload, "battery", state.battery);
            state.sessionActive = firstBoolean(payload, state.sessionActive, "sessionActive", "session_active");
            state.calibrated = firstBoolean(payload, state.calibrated, "calibrated");
            state.readyForSession = firstBoolean(payload, state.readyForSession, "readyForSession", "ready_for_session", "ready");
            updatePressureModeFields(state, payload);
            indexSession(state);
        });
    }

    public void updateFromDebug(String deviceId, JsonNode payload) {
        upsert(deviceId, state -> {
            state.lastSeen = Instant.now();
            state.online = true;
            state.manikinId = firstTextWithFallback(payload, state.manikinId, "manikinId", "manikin_id");
            state.sessionId = firstTextWithFallback(payload, state.sessionId, "sessionId", "session_id");
            state.state = canonicalFirmwareState(firstTextWithFallback(payload, state.state, "state", "debugState", "firmwareState", "firmware_state"));
            state.ip = firstTextWithFallback(payload, state.ip, "ip", "ipAddress", "ip_address");
            state.fw = firstTextWithFallback(payload, state.fw, "fw", "firmware", "firmwareVersion", "firmware_version");
            state.rssi = firstInt(payload, "rssi", state.rssi);
            state.battery = firstInt(payload, "battery", state.battery);
            state.sessionActive = firstBoolean(payload, state.sessionActive, "sessionActive", "session_active");
            indexSession(state);
        });
    }

    public void updateFromTelemetry(String deviceId, JsonNode payload) {
        upsert(deviceId, state -> {
            state.lastSeen = Instant.now();
            state.online = true;
            state.manikinId = firstText(payload, "manikinId", "manikin_id", state.manikinId);
            state.sessionId = firstText(payload, "sessionId", "session_id", state.sessionId);
            state.seq = firstLong(payload, state.seq, "seq");
            Double payloadDepthMm = firstDouble(payload, null, "depthMm", "depth_mm");
            Double payloadDepthProgress = firstDouble(payload, null, "depthProgress", "depth_progress");
            if (payloadDepthMm != null) {
                state.latestDepthMm = payloadDepthMm;
            } else if (payloadDepthProgress != null) {
                state.latestDepthMm = null;
            }
            state.latestRateCpm = firstDouble(payload, state.latestRateCpm, "rateCpm", "rate_cpm");
            state.latestRecoilOk = firstBoolean(payload, state.latestRecoilOk, "recoilOk", "recoil_ok", "recoil");
            state.latestPauseS = firstDouble(payload, state.latestPauseS, "pauseS", "pause_s");
            Integer compressionCount = firstInt(payload, "compressionCount", null);
            if (compressionCount == null) {
                compressionCount = firstInt(payload, "compression_count", null);
            }
            if (compressionCount == null) {
                compressionCount = firstInt(payload, "total_compressions", null);
            }
            state.latestForce1 = firstLong(payload, state.latestForce1, "force1");
            state.latestForce2 = firstLong(payload, state.latestForce2, "force2");

            if (state.latestForce1 != null && state.latestForce2 != null) {
                long sum = state.latestForce1 + state.latestForce2;
                long absDiff = Math.abs(state.latestForce1 - state.latestForce2);
                state.pressureBalancePct = sum > 0 ? 100.0 - ((absDiff * 100.0) / sum) : null;
                state.pressureSkewed = state.pressureBalancePct != null && state.pressureBalancePct < 88.0;
            }
            Double payloadPressureBalancePct = firstDouble(payload, null, "pressureBalancePct", "pressure_balance_pct");
            if (payloadPressureBalancePct != null) {
                state.pressureBalancePct = payloadPressureBalancePct;
                state.pressureSkewed = payloadPressureBalancePct < 88.0;
            }
            updatePressureModeFields(state, payload);
            state.depthSource = firstTextWithFallback(payload, state.depthSource, "depthSource", "depth_source", "sourceMode", "source_mode");

            state.latestFlags = firstFlags(payload, "flags", state.latestFlags);
            state.latestMetric = new LiveMetricPayload(
                    firstText(payload, "deviceId", "device_id", state.deviceId),
                    state.manikinId,
                    state.sessionId,
                    state.seq,
                    firstLong(payload, null, "tsMs", "ts_ms"),
                    jsonValue(payload.get("timestamp")),
                    state.latestDepthMm,
                    payloadDepthProgress,
                    firstBoolean(payload, null, "depthOk", "depth_ok"),
                    state.latestRateCpm,
                    state.latestRecoilOk,
                    state.latestPauseS,
                    compressionCount,
                    firstInt(payload, "validCompressionCount", null) != null
                            ? firstInt(payload, "validCompressionCount", null)
                            : firstInt(payload, "valid_compression_count", null),
                    firstInt(payload, "recoilOkCount", null) != null
                            ? firstInt(payload, "recoilOkCount", null)
                            : firstInt(payload, "recoil_ok_count", null),
                    firstInt(payload, "incompleteRecoilCount", null) != null
                            ? firstInt(payload, "incompleteRecoilCount", null)
                            : firstInt(payload, "incomplete_recoil_count", null),
                    firstText(payload, "handPlacement", "hand_placement", null),
                    jsonValue(payload.get("flags")),
                    state.pressureBalancePct,
                    firstTextWithFallback(payload, state.depthSource, "sourceMode", "source_mode", "depthSource", "depth_source"),
                    jsonValue(payload.get("debugRaw"))
            );
            indexSession(state);
        });
    }

    public void updateFromEvent(String deviceId, JsonNode payload) {
        upsert(deviceId, state -> {
            state.lastSeen = Instant.now();
            state.online = true;
            state.sessionId = firstText(payload, "sessionId", "session_id", state.sessionId);
            state.lastEventType = firstScalarAsText(payload, state.lastEventType, "eventId", "event_id", "eventType", "event_type", "type");
            indexSession(state);
        });
    }

    public void updateFromCalibrationEvent(String deviceId, JsonNode payload) {
        upsert(deviceId, state -> {
            state.lastSeen = Instant.now();
            state.online = true;
            state.sessionId = firstText(payload, "sessionId", "session_id", state.sessionId);
            state.lastEventType = firstScalarAsText(payload, state.lastEventType, "eventId", "event_id", "eventType", "event_type");
            state.firmwareState = firstTextWithFallback(payload, state.firmwareState, "state", "firmwareState", "firmware_state");
            state.calibrationProgressId = firstInt(payload, "progress_id", state.calibrationProgressId);
            state.calibrationProgressId = firstInt(payload, "progressId", state.calibrationProgressId);
            state.calibrationReasonId = normalizedReasonId(firstScalarAsText(payload, state.calibrationReasonId, "reason_id", "reasonId"));
            state.calibrationActionId = firstInt(payload, "action_id", state.calibrationActionId);
            state.calibrationActionId = firstInt(payload, "actionId", state.calibrationActionId);
            state.calibrationResult = firstTextWithFallback(payload, state.calibrationResult, "result", "calibrationResult", "calibration_result");
            state.profileId = firstTextWithFallback(payload, state.profileId, "profileId", "profile_id");
            updatePressureModeFields(state, payload);
            if (state.calibrationReasonId != null && !"00000".equals(state.calibrationReasonId)) {
                state.warnings = appendWarning(state.warnings, state.calibrationReasonId);
            }
            String result = firstText(payload, "result", "calibrationResult", "calibration_result", "state");
            if (result != null) {
                String normalized = result.toLowerCase(Locale.ROOT);
                state.state = switch (normalized) {
                    case "pass", "passed", "pass_with_warnings", "ready", "ok" -> {
                        state.calibrated = true;
                        state.readyForSession = true;
                        state.calibrationState = "READY";
                        yield "READY_FOR_SESSION";
                    }
                    case "fail", "failed", "error" -> {
                        state.calibrated = false;
                        state.readyForSession = false;
                        state.calibrationState = "FAILED";
                        yield "CALIBRATION_FAIL";
                    }
                    case "cancel", "cancelled", "canceled" -> "CALIBRATION_CANCELLED";
                    default -> canonicalFirmwareState(result);
                };
            } else if (state.firmwareState != null) {
                state.state = canonicalFirmwareState(state.firmwareState);
            }
            if ("STARTED".equalsIgnoreCase(state.calibrationResult) || "CALIBRATING".equalsIgnoreCase(state.firmwareState)) {
                state.calibrationState = "CALIBRATING";
                state.readyForSession = false;
            }
            if ("CALIBRATION_CANCELLED".equals(state.state)) {
                state.calibrated = false;
                state.readyForSession = false;
                state.calibrationState = "CANCELLED";
            }
            state.sessionActive = false;
            indexSession(state);
        });
    }

    public void updateFromErrorEvent(String deviceId, JsonNode payload) {
        upsert(deviceId, state -> {
            state.lastSeen = Instant.now();
            state.online = true;
            state.sessionId = firstText(payload, "sessionId", "session_id", state.sessionId);
            state.lastEventType = firstScalarAsText(payload, state.lastEventType, "eventId", "event_id", "eventType", "event_type");
            state.state = firstText(payload, "state", "errorState", "error_state", null);
            if (state.state == null || state.state.isBlank()) {
                state.state = "ERROR";
            }
            state.sessionActive = false;
            indexSession(state);
        });
    }

    public List<ManikinLiveSummary> getLiveSummaries() {
        markStaleOffline();

        return registry.values().stream()
                .map(this::toSummary)
                .sorted(Comparator.comparing(ManikinLiveSummary::deviceId))
                .toList();
    }

    public Optional<ManikinLiveSummary> getLiveSummary(String deviceId) {
        markStaleOffline();
        MutableManikinState state = registry.get(deviceId);

        if (state == null) {
            return Optional.empty();
        }

        return Optional.of(toSummary(state));
    }

    public Optional<SessionLiveView> getSessionLiveView(String sessionId) {
        markStaleOffline();
        MutableManikinState state = registryBySessionId.get(sessionId);
        if (state == null) {
            return Optional.empty();
        }

        return Optional.of(toSessionLiveView(state, sessionId));
    }

    private void upsert(String deviceId, Consumer<MutableManikinState> updater) {
        String normalizedDeviceId = normalizeDeviceId(deviceId);
        registry.compute(normalizedDeviceId, (key, existing) -> {
            MutableManikinState state = existing != null ? existing : new MutableManikinState(normalizedDeviceId);
            updater.accept(state);
            return state;
        });
    }

    private void markStaleOffline() {
        markStaleOfflineAndGetChangedDeviceIds();
    }

    public List<String> markStaleOfflineAndGetChangedDeviceIds() {
        Instant now = Instant.now();
        List<String> changedDeviceIds = new ArrayList<>();

        for (MutableManikinState state : registry.values()) {
            if (state.lastSeen == null) {
                continue;
            }

            if (Duration.between(state.lastSeen, now).compareTo(staleAfter) > 0 && state.online) {
                state.online = false;
                if (state.state == null || state.state.isBlank() || "online".equalsIgnoreCase(state.state)) {
                    state.state = "offline";
                }
                changedDeviceIds.add(state.deviceId);
            }
        }

        for (MutableManikinState state : registryBySessionId.values()) {
            markStateOfflineIfStale(state, now);
        }

        return changedDeviceIds;
    }

    private boolean markStateOfflineIfStale(MutableManikinState state, Instant now) {
        if (state.lastSeen == null) {
            return false;
        }

        if (Duration.between(state.lastSeen, now).compareTo(staleAfter) > 0 && state.online) {
            state.online = false;
            if (state.state == null || state.state.isBlank() || "online".equalsIgnoreCase(state.state)) {
                state.state = "offline";
            }
            return true;
        }

        return false;
    }

    private ManikinLiveSummary toSummary(MutableManikinState state) {
        boolean stale = isStale(state);
        boolean offline = !state.online;
        return new ManikinLiveSummary(
                state.deviceId,
                state.sessionId,
                state.manikinId,
                state.online,
                state.lastSeen,
                state.state,
                state.ip,
                state.fw,
                state.rssi,
                state.battery,
                state.sessionActive,
                state.latestDepthMm,
                state.latestRateCpm,
                state.latestRecoilOk,
                state.latestPauseS,
                state.latestFlags,
                state.lastEventType,
                state.latestForce1,
                state.latestForce2,
                state.pressureBalancePct,
                state.pressureSkewed,
                state.firmwareState,
                state.calibrated,
                state.readyForSession,
                state.calibrationState,
                state.calibrationProgressId,
                state.calibrationReasonId,
                state.calibrationActionId,
                state.calibrationProgressId,
                state.calibrationReasonId,
                state.calibrationActionId,
                state.calibrationResult,
                state.profileId,
                state.pressureMode,
                state.pressureDegraded,
                state.usingLastStablePressure,
                state.pressureValid,
                state.hallValid,
                state.depthSource,
                state.warnings,
                null,
                null,
                null,
                null,
                state.latestMetric != null ? state.latestMetric.depthProgress() : null,
                state.latestMetric != null ? state.latestMetric.compressionCount() : null,
                state.latestMetric,
                state.seq,
                connectionState(state, stale, offline),
                stale,
                offline
        );
    }

    private SessionLiveView toSessionLiveView(MutableManikinState state, String sessionId) {
        boolean stale = isStale(state);
        boolean offline = !state.online;
        return new SessionLiveView(
                sessionId,
                state.deviceId,
                state.manikinId,
                null,
                Boolean.TRUE.equals(state.sessionActive),
                null,
                null,
                null,
                state.lastSeen,
                state.state,
                state.online,
                state.ip,
                state.fw,
                state.rssi,
                state.battery,
                state.sessionActive,
                state.latestDepthMm,
                state.latestRateCpm,
                state.latestRecoilOk,
                state.latestPauseS,
                state.latestFlags,
                state.lastEventType,
                state.latestForce1,
                state.latestForce2,
                state.pressureBalancePct,
                state.pressureSkewed,
                state.latestMetric,
                state.seq,
                connectionState(state, stale, offline),
                stale,
                offline
        );
    }

    private void indexSession(MutableManikinState state) {
        if (state.sessionId != null && !state.sessionId.isBlank()) {
            registryBySessionId.put(state.sessionId, copyState(state));
        }
    }

    private MutableManikinState copyState(MutableManikinState source) {
        MutableManikinState copy = new MutableManikinState(source.deviceId);
        copy.online = source.online;
        copy.lastSeen = source.lastSeen;
        copy.sessionId = source.sessionId;
        copy.manikinId = source.manikinId;
        copy.seq = source.seq;
        copy.state = source.state;
        copy.ip = source.ip;
        copy.fw = source.fw;
        copy.rssi = source.rssi;
        copy.battery = source.battery;
        copy.sessionActive = source.sessionActive;
        copy.latestDepthMm = source.latestDepthMm;
        copy.latestRateCpm = source.latestRateCpm;
        copy.latestRecoilOk = source.latestRecoilOk;
        copy.latestPauseS = source.latestPauseS;
        copy.latestFlags = source.latestFlags;
        copy.lastEventType = source.lastEventType;
        copy.latestForce1 = source.latestForce1;
        copy.latestForce2 = source.latestForce2;
        copy.pressureBalancePct = source.pressureBalancePct;
        copy.pressureSkewed = source.pressureSkewed;
        copy.firmwareState = source.firmwareState;
        copy.calibrated = source.calibrated;
        copy.readyForSession = source.readyForSession;
        copy.calibrationState = source.calibrationState;
        copy.calibrationProgressId = source.calibrationProgressId;
        copy.calibrationReasonId = source.calibrationReasonId;
        copy.calibrationActionId = source.calibrationActionId;
        copy.calibrationResult = source.calibrationResult;
        copy.profileId = source.profileId;
        copy.pressureMode = source.pressureMode;
        copy.pressureDegraded = source.pressureDegraded;
        copy.usingLastStablePressure = source.usingLastStablePressure;
        copy.pressureValid = source.pressureValid;
        copy.hallValid = source.hallValid;
        copy.depthSource = source.depthSource;
        copy.warnings = source.warnings;
        copy.latestMetric = source.latestMetric;
        return copy;
    }

    private boolean isStale(MutableManikinState state) {
        return state.lastSeen != null && Duration.between(state.lastSeen, Instant.now()).compareTo(staleAfter) > 0;
    }

    private String connectionState(MutableManikinState state, boolean stale, boolean offline) {
        if (offline) {
            return "OFFLINE";
        }
        if (stale) {
            return "STALE";
        }
        if (state.lastSeen == null) {
            return "CONNECTING";
        }
        return "BACKEND_SSE_FALLBACK";
    }

    private static String firstTextWithFallback(JsonNode payload, String fallback, String... keys) {
        if (payload == null) {
            return fallback;
        }

        for (String key : keys) {
            String value = text(payload, key);
            if (value != null) {
                return value;
            }
        }

        return fallback;
    }

    private static void updatePressureModeFields(MutableManikinState state, JsonNode payload) {
        state.pressureMode = firstTextWithFallback(payload, state.pressureMode, "pressureMode", "pressure_mode");
        state.pressureDegraded = firstBoolean(payload, state.pressureDegraded, "pressureDegraded", "pressure_degraded");
        state.usingLastStablePressure = firstBoolean(payload, state.usingLastStablePressure, "usingLastStablePressure", "using_last_stable_pressure");
        state.pressureValid = firstBoolean(payload, state.pressureValid, "pressureValid", "pressure_valid");
        state.hallValid = firstBoolean(payload, state.hallValid, "hallValid", "hall_valid");
        String warnings = firstScalarAsText(payload, null, "warnings", "warning");
        if (warnings != null) {
            state.warnings = appendWarning(state.warnings, warnings);
        }
    }

    private static String appendWarning(String existing, String warning) {
        if (warning == null || warning.isBlank()) {
            return existing;
        }
        if (existing == null || existing.isBlank()) {
            return warning.trim();
        }
        if (existing.contains(warning.trim())) {
            return existing;
        }
        return existing + "," + warning.trim();
    }

    private static String firstText(JsonNode payload, String firstKey, String secondKey, String fallback) {
        String value = text(payload, firstKey);
        if (value != null) {
            return value;
        }

        value = text(payload, secondKey);
        if (value != null) {
            return value;
        }

        return fallback;
    }

    private static String firstText(JsonNode payload, String firstKey, String secondKey, String thirdKey, String fallback) {
        String value = text(payload, firstKey);
        if (value != null) {
            return value;
        }

        value = text(payload, secondKey);
        if (value != null) {
            return value;
        }

        value = text(payload, thirdKey);
        if (value != null) {
            return value;
        }

        return fallback;
    }

    private static String firstText(String value, String fallback) {
        if (value == null) {
            return fallback;
        }

        String trimmed = value.trim();
        return trimmed.isEmpty() ? fallback : trimmed;
    }

    private static String firstScalarAsText(JsonNode payload, String fallback, String... keys) {
        for (String key : keys) {
            JsonNode node = payload.get(key);
            if (node == null || node.isNull()) {
                continue;
            }

            if (node.isTextual()) {
                String value = node.asText().trim();
                if (!value.isEmpty()) {
                    return value;
                }
            }

            if (node.isNumber()) {
                return node.asText();
            }
        }

        return fallback;
    }

    private static String text(JsonNode payload, String key) {
        JsonNode node = payload.get(key);
        if (node == null || node.isNull()) {
            return null;
        }

        String value = node.asText().trim();
        return value.isEmpty() ? null : value;
    }

    private static Integer firstInt(JsonNode payload, String key, Integer fallback) {
        JsonNode node = payload.get(key);
        if (node == null || node.isNull() || !node.isNumber()) {
            return fallback;
        }

        return node.asInt();
    }

    private static Long firstLong(JsonNode payload, Long fallback, String... keys) {
        for (String key : keys) {
            JsonNode node = payload.get(key);
            if (node != null && !node.isNull() && node.isNumber()) {
                return node.asLong();
            }
        }

        return fallback;
    }

    private static Double firstDouble(JsonNode payload, Double fallback, String... keys) {
        for (String key : keys) {
            JsonNode node = payload.get(key);
            if (node != null && !node.isNull() && node.isNumber()) {
                return node.asDouble();
            }
        }

        return fallback;
    }

    private static Boolean firstBoolean(JsonNode payload, Boolean fallback, String... keys) {
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

        return fallback;
    }

    private static String firstFlags(JsonNode payload, String key, String fallback) {
        JsonNode node = payload.get(key);
        if (node == null || node.isNull()) {
            return fallback;
        }

        if (node.isTextual()) {
            String value = node.asText().trim();
            return value.isEmpty() ? fallback : value;
        }

        return node.toString();
    }

    private static Object jsonValue(JsonNode node) {
        if (node == null || node.isNull()) {
            return null;
        }
        if (node.isTextual()) {
            return node.asText();
        }
        if (node.isBoolean()) {
            return node.asBoolean();
        }
        if (node.isIntegralNumber()) {
            return node.asLong();
        }
        if (node.isFloatingPointNumber()) {
            return node.asDouble();
        }
        return node;
    }

    private static String canonicalFirmwareState(String value) {
        if (value == null) {
            return null;
        }

        String trimmed = value.trim();
        if (trimmed.isEmpty()) {
            return null;
        }

        return switch (trimmed.toLowerCase(Locale.ROOT)) {
            case "pass", "passed", "ready", "ok" -> "READY_FOR_SESSION";
            case "fail", "failed" -> "CALIBRATION_FAIL";
            case "cancel", "cancelled", "canceled" -> "CALIBRATION_CANCELLED";
            default -> trimmed;
        };
    }

    private static String normalizedReasonId(String value) {
        if (value == null) {
            return null;
        }

        String trimmed = value.trim();
        if (trimmed.isEmpty()) {
            return null;
        }

        if (trimmed.chars().allMatch(Character::isDigit)) {
            int numeric = Integer.parseInt(trimmed);
            return switch (numeric) {
                case 0 -> "00000";
                case 100 -> "08101";
                case 101 -> "08102";
                case 102 -> "08103";
                case 200 -> "08401";
                case 201 -> "08402";
                case 202 -> "08403";
                case 203 -> "08404";
                case 204 -> "08405";
                case 205 -> "08406";
                case 206 -> "08407";
                case 207 -> "08408";
                case 208 -> "08409";
                case 209 -> "08410";
                case 210 -> "08418";
                case 211 -> "08412";
                case 212 -> "08413";
                case 213 -> "08414";
                case 214 -> "08415";
                case 215 -> "08416";
                case 216 -> "08417";
                case 217 -> "08411";
                case 300 -> "08301";
                case 400 -> "08501";
                case 401 -> "08502";
                case 900 -> "08701";
                default -> String.format(Locale.ROOT, "%05d", numeric);
            };
        }

        return trimmed;
    }

    private static String normalizeDeviceId(String deviceId) {
        String normalized = deviceId == null ? "" : deviceId.trim();
        if (normalized.isEmpty()) {
            throw new IllegalArgumentException("deviceId must not be blank");
        }
        return normalized;
    }

    private static class MutableManikinState {
        private final String deviceId;
        private boolean online;
        private Instant lastSeen;
        private String sessionId;
        private String manikinId;
        private Long seq;
        private String state;
        private String ip;
        private String fw;
        private Integer rssi;
        private Integer battery;
        private Boolean sessionActive;
        private Double latestDepthMm;
        private Double latestRateCpm;
        private Boolean latestRecoilOk;
        private Double latestPauseS;
        private String latestFlags;
        private String lastEventType;
        private Long latestForce1;
        private Long latestForce2;
        private Double pressureBalancePct;
        private Boolean pressureSkewed;
        private String firmwareState;
        private Boolean calibrated;
        private Boolean readyForSession;
        private String calibrationState;
        private Integer calibrationProgressId;
        private String calibrationReasonId;
        private Integer calibrationActionId;
        private String calibrationResult;
        private String profileId;
        private String pressureMode;
        private Boolean pressureDegraded;
        private Boolean usingLastStablePressure;
        private Boolean pressureValid;
        private Boolean hallValid;
        private String depthSource;
        private String warnings;
        private LiveMetricPayload latestMetric;

        private MutableManikinState(String deviceId) {
            this.deviceId = deviceId;
            this.online = false;
            this.state = "unknown";
        }
    }
}
