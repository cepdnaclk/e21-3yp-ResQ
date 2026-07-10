package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.JsonNode;
import lk.resq.localhub.model.firmware.SensorStreamSnapshot;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.CopyOnWriteArrayList;

@Service
public class SensorStreamService {

    public static final int SENSOR_STREAM_MIN_INTERVAL_MS = 100;
    public static final int SENSOR_STREAM_DEFAULT_INTERVAL_MS = 200;
    public static final int SENSOR_STREAM_MAX_INTERVAL_MS = 1000;

    private static final long SSE_TIMEOUT_MS = 0L;

    private final ConcurrentMap<String, SensorStreamSnapshot> latestSnapshots = new ConcurrentHashMap<>();
    private final ConcurrentMap<String, CopyOnWriteArrayList<SseEmitter>> emittersByDeviceId = new ConcurrentHashMap<>();

    public SensorStreamSnapshot parseSnapshot(String topicDeviceId, JsonNode payload, Instant receivedAt) {
        String deviceId = requiredText(payload, "device_id", "deviceId");
        if (deviceId == null) {
            deviceId = topicDeviceId;
        }
        if (deviceId == null || deviceId.isBlank()) {
            throw new IllegalArgumentException("SENSOR_STREAM device_id is required");
        }
        if (topicDeviceId != null && !topicDeviceId.isBlank() && !topicDeviceId.equals(deviceId)) {
            throw new IllegalArgumentException("SENSOR_STREAM device_id must match MQTT topic device id");
        }

        String telemetryMode = requiredText(payload, "telemetry_mode", "telemetryMode");
        if (!"SENSOR_STREAM".equals(telemetryMode)) {
            throw new IllegalArgumentException("telemetry_mode must be SENSOR_STREAM");
        }

        Double hallProgress = requiredDouble(payload, "hall_progress", "hallProgress");
        if (hallProgress < 0.0 || hallProgress > 1.0) {
            throw new IllegalArgumentException("hall_progress must be between 0 and 1");
        }

        Integer intervalMs = requiredInt(payload, "interval_ms", "intervalMs");
        validateIntervalMs(intervalMs);

        Integer saturationMask = requiredInt(payload, "pressure_saturation_mask", "pressureSaturationMask");
        if (saturationMask < 0 || saturationMask > 0b111) {
            throw new IllegalArgumentException("pressure_saturation_mask must only contain pressure channel bits 0-2");
        }

        return new SensorStreamSnapshot(
                deviceId,
                telemetryMode,
                requiredText(payload, "state"),
                requiredDouble(payload, "pressure_0_kpa", "pressure0Kpa"),
                requiredBoolean(payload, "pressure_0_kpa_valid", "pressure0KpaValid"),
                requiredDouble(payload, "pressure_1_kpa", "pressure1Kpa"),
                requiredBoolean(payload, "pressure_1_kpa_valid", "pressure1KpaValid"),
                requiredDouble(payload, "pressure_2_kpa", "pressure2Kpa"),
                requiredBoolean(payload, "pressure_2_kpa_valid", "pressure2KpaValid"),
                requiredBoolean(payload, "pressure_kpa_valid", "pressureKpaValid"),
                requiredDouble(payload, "hall_mm", "hallMm"),
                hallProgress,
                requiredBoolean(payload, "hall_mm_valid", "hallMmValid"),
                saturationMask,
                intervalMs,
                requiredLong(payload, "ts_ms", "tsMs"),
                receivedAt == null ? Instant.now() : receivedAt
        );
    }

    public void recordSnapshot(SensorStreamSnapshot snapshot) {
        latestSnapshots.put(snapshot.deviceId(), snapshot);
        publish(snapshot.deviceId(), snapshot);
    }

    public Optional<SensorStreamSnapshot> latestSnapshot(String deviceId) {
        return Optional.ofNullable(latestSnapshots.get(deviceId));
    }

    public SseEmitter subscribe(String deviceId) {
        SseEmitter emitter = new SseEmitter(SSE_TIMEOUT_MS);
        CopyOnWriteArrayList<SseEmitter> emitters = emittersByDeviceId.computeIfAbsent(deviceId, ignored -> new CopyOnWriteArrayList<>());
        emitters.add(emitter);
        emitter.onCompletion(() -> emitters.remove(emitter));
        emitter.onTimeout(() -> emitters.remove(emitter));
        emitter.onError(error -> emitters.remove(emitter));

        latestSnapshot(deviceId).ifPresent(snapshot -> send(emitter, snapshot));
        return emitter;
    }

    public int subscriberCount(String deviceId) {
        return emittersByDeviceId.getOrDefault(deviceId, new CopyOnWriteArrayList<>()).size();
    }

    public static void validateIntervalMs(Integer intervalMs) {
        if (intervalMs == null) {
            throw new IllegalArgumentException("interval_ms is required");
        }
        if (intervalMs < SENSOR_STREAM_MIN_INTERVAL_MS || intervalMs > SENSOR_STREAM_MAX_INTERVAL_MS) {
            throw new IllegalArgumentException("interval_ms must be between 100 and 1000");
        }
    }

    private void publish(String deviceId, SensorStreamSnapshot snapshot) {
        List<SseEmitter> deadEmitters = new ArrayList<>();
        for (SseEmitter emitter : emittersByDeviceId.getOrDefault(deviceId, new CopyOnWriteArrayList<>())) {
            if (!send(emitter, snapshot)) {
                deadEmitters.add(emitter);
            }
        }
        if (!deadEmitters.isEmpty()) {
            emittersByDeviceId.getOrDefault(deviceId, new CopyOnWriteArrayList<>()).removeAll(deadEmitters);
        }
    }

    private boolean send(SseEmitter emitter, SensorStreamSnapshot snapshot) {
        try {
            emitter.send(SseEmitter.event()
                    .name("sensor-stream")
                    .id(snapshot.deviceId() + "-" + snapshot.tsMs())
                    .data(snapshot));
            return true;
        } catch (IOException | IllegalStateException error) {
            emitter.completeWithError(error);
            return false;
        }
    }

    private static String requiredText(JsonNode payload, String... keys) {
        for (String key : keys) {
            JsonNode node = payload == null ? null : payload.get(key);
            if (node == null || node.isNull()) {
                continue;
            }
            String value = node.asText().trim();
            if (!value.isEmpty()) {
                return value;
            }
        }
        if (keys.length > 0 && ("device_id".equals(keys[0]) || "deviceId".equals(keys[0]))) {
            return null;
        }
        throw new IllegalArgumentException(keys[0] + " is required");
    }

    private static Double requiredDouble(JsonNode payload, String... keys) {
        for (String key : keys) {
            JsonNode node = payload == null ? null : payload.get(key);
            if (node != null && node.isNumber() && Double.isFinite(node.asDouble())) {
                return node.asDouble();
            }
        }
        throw new IllegalArgumentException(keys[0] + " is required and must be a finite number");
    }

    private static Integer requiredInt(JsonNode payload, String... keys) {
        for (String key : keys) {
            JsonNode node = payload == null ? null : payload.get(key);
            if (node != null && node.isIntegralNumber()) {
                return node.asInt();
            }
        }
        throw new IllegalArgumentException(keys[0] + " is required and must be an integer");
    }

    private static Long requiredLong(JsonNode payload, String... keys) {
        for (String key : keys) {
            JsonNode node = payload == null ? null : payload.get(key);
            if (node != null && node.isIntegralNumber()) {
                return node.asLong();
            }
        }
        throw new IllegalArgumentException(keys[0] + " is required and must be an integer");
    }

    private static Boolean requiredBoolean(JsonNode payload, String... keys) {
        for (String key : keys) {
            JsonNode node = payload == null ? null : payload.get(key);
            if (node != null && node.isBoolean()) {
                return node.asBoolean();
            }
        }
        throw new IllegalArgumentException(keys[0] + " is required and must be a boolean");
    }
}
