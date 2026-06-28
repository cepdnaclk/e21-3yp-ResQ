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
            state.sessionId = firstText(payload, "sessionId", "session_id", state.sessionId);
            state.state = canonicalFirmwareState(firstText(payload, "state", "status", state.state));
            state.ip = firstText(payload, "ip", "ipAddress", state.ip);
            state.fw = firstText(payload, "fw", "firmware", state.fw);
            state.sessionActive = firstBoolean(payload, state.sessionActive, "sessionActive");
            indexSession(state);
        });
    }

    public void updateFromHeartbeat(String deviceId, JsonNode payload) {
        upsert(deviceId, state -> {
            state.lastSeen = Instant.now();
            state.online = true;
            state.manikinId = firstText(payload, "manikinId", "manikin_id", state.manikinId);
            state.sessionId = firstText(payload, "sessionId", "session_id", state.sessionId);
            state.state = canonicalFirmwareState(firstText(payload, "state", "status", state.state));
            state.ip = firstText(payload, "ip", "ipAddress", state.ip);
            state.fw = firstText(payload, "fw", "firmware", state.fw);
            state.rssi = firstInt(payload, "rssi", state.rssi);
            state.battery = firstInt(payload, "battery", state.battery);
            state.sessionActive = firstBoolean(payload, state.sessionActive, "sessionActive");
            indexSession(state);
        });
    }

    public void updateFromDebug(String deviceId, JsonNode payload) {
        upsert(deviceId, state -> {
            state.lastSeen = Instant.now();
            state.online = true;
            state.manikinId = firstText(payload, "manikinId", "manikin_id", state.manikinId);
            state.sessionId = firstText(payload, "sessionId", "session_id", state.sessionId);
            state.state = canonicalFirmwareState(firstText(payload, "state", "debugState", state.state));
            state.ip = firstText(payload, "ip", "ipAddress", state.ip);
            state.fw = firstText(payload, "fw", "firmware", state.fw);
            state.rssi = firstInt(payload, "rssi", state.rssi);
            state.battery = firstInt(payload, "battery", state.battery);
            state.sessionActive = firstBoolean(payload, state.sessionActive, "sessionActive");
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
                    firstText(payload, "sourceMode", "source_mode", null),
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
            String result = firstText(payload, "result", "calibrationResult", "calibration_result", "state");
            if (result != null) {
                String normalized = result.toLowerCase(Locale.ROOT);
                state.state = switch (normalized) {
                    case "pass", "passed", "ready", "ok" -> "READY_FOR_SESSION";
                    case "fail", "failed", "error" -> "CALIBRATION_FAIL";
                    case "cancel", "cancelled", "canceled" -> "CALIBRATION_CANCELLED";
                    default -> result;
                };
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

    public void registerDevice(String deviceId) {
        upsert(deviceId, state -> {
            if (state.lastSeen == null) {
                state.online = false;
            }
            if (!state.online) {
                state.state = "PAIRED_IDLE";
            }
            state.sessionActive = false;
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
        registry.compute(deviceId, (key, existing) -> {
            MutableManikinState state = existing != null ? existing : new MutableManikinState(deviceId);
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
                null,
                null,
                null,
                null,
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
        private LiveMetricPayload latestMetric;

        private MutableManikinState(String deviceId) {
            this.deviceId = deviceId;
            this.online = false;
            this.state = "unknown";
        }
    }
}
