package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.JsonNode;
import lk.resq.localhub.model.ManikinLiveSummary;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.function.Consumer;

@Service
public class ManikinRegistryService {

    private static final Duration STALE_AFTER = Duration.ofSeconds(12);

    private final ConcurrentMap<String, MutableManikinState> registry = new ConcurrentHashMap<>();

    public void updateFromStatus(String deviceId, JsonNode payload) {
        upsert(deviceId, state -> {
            state.lastSeen = Instant.now();
            state.online = true;
            state.state = firstText(payload, "state", "status", state.state);
            state.ip = firstText(payload, "ip", "ipAddress", state.ip);
            state.fw = firstText(payload, "fw", "firmware", state.fw);
            state.sessionActive = firstBoolean(payload, state.sessionActive, "sessionActive");
        });
    }

    public void updateFromHeartbeat(String deviceId, JsonNode payload) {
        upsert(deviceId, state -> {
            state.lastSeen = Instant.now();
            state.online = true;
            state.state = firstText(payload, "state", "status", state.state);
            state.ip = firstText(payload, "ip", "ipAddress", state.ip);
            state.fw = firstText(payload, "fw", "firmware", state.fw);
            state.rssi = firstInt(payload, "rssi", state.rssi);
            state.battery = firstInt(payload, "battery", state.battery);
            state.sessionActive = firstBoolean(payload, state.sessionActive, "sessionActive");
        });
    }

    public void updateFromTelemetry(String deviceId, JsonNode payload) {
        upsert(deviceId, state -> {
            state.lastSeen = Instant.now();
            state.online = true;
            state.latestDepthMm = firstDouble(payload, state.latestDepthMm, "depthMm", "depth_mm");
            state.latestRateCpm = firstDouble(payload, state.latestRateCpm, "rateCpm", "rate_cpm");
            state.latestRecoilOk = firstBoolean(payload, state.latestRecoilOk, "recoilOk", "recoil_ok");
            state.latestPauseS = firstDouble(payload, state.latestPauseS, "pauseS", "pause_s");
            state.latestFlags = firstFlags(payload, "flags", state.latestFlags);
        });
    }

    public void updateFromEvent(String deviceId, JsonNode payload) {
        upsert(deviceId, state -> {
            state.lastSeen = Instant.now();
            state.online = true;
            state.lastEventType = firstText(payload, "eventType", "type", state.lastEventType);
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

    private void upsert(String deviceId, Consumer<MutableManikinState> updater) {
        registry.compute(deviceId, (key, existing) -> {
            MutableManikinState state = existing != null ? existing : new MutableManikinState(deviceId);
            updater.accept(state);
            return state;
        });
    }

    private void markStaleOffline() {
        Instant now = Instant.now();

        for (MutableManikinState state : registry.values()) {
            if (state.lastSeen == null) {
                continue;
            }

            if (Duration.between(state.lastSeen, now).compareTo(STALE_AFTER) > 0) {
                state.online = false;
                if (state.state == null || state.state.isBlank() || "online".equalsIgnoreCase(state.state)) {
                    state.state = "offline";
                }
            }
        }
    }

    private ManikinLiveSummary toSummary(MutableManikinState state) {
        return new ManikinLiveSummary(
                state.deviceId,
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
                null,
                null,
                null,
                null
        );
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

    private static class MutableManikinState {
        private final String deviceId;
        private boolean online;
        private Instant lastSeen;
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

        private MutableManikinState(String deviceId) {
            this.deviceId = deviceId;
            this.online = false;
            this.state = "unknown";
        }
    }
}
