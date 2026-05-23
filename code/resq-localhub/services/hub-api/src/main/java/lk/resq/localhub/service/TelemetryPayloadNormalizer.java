package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.JsonNode;
import lk.resq.localhub.model.LiveMetricPayload;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

final class TelemetryPayloadNormalizer {

    private TelemetryPayloadNormalizer() {
    }

    static TelemetryNormalizationResult normalize(JsonNode payload) {
        List<String> warnings = new ArrayList<>();
        if (payload == null || !payload.isObject()) {
            return TelemetryNormalizationResult.rejected("payload must be a JSON object", warnings);
        }

        String deviceId = firstText(payload, "deviceId", "device_id");
        String sessionId = firstText(payload, "sessionId", "session_id");
        if (deviceId == null) {
            return TelemetryNormalizationResult.rejected("payload deviceId is missing", warnings);
        }
        if (sessionId == null) {
            return TelemetryNormalizationResult.rejected("payload sessionId is missing", warnings);
        }

        Double depthMm = firstDouble(payload, "depthMm", "depth_mm");
        String sourceMode = normalizeSourceMode(firstText(payload, "sourceMode", "source_mode", "mode"));
        if (depthMm == null) {
            depthMm = firstDouble(payload, "depth_progress", "depthProgress", "current_delta", "currentDelta");
            if (depthMm != null) {
                warnings.add("used firmware depth_progress/current_delta as fallback depthMm");
                if (sourceMode == null || "real".equals(sourceMode)) {
                    sourceMode = "simulator";
                }
            }
        }

        Double rateCpm = firstDouble(payload, "rateCpm", "rate_cpm");
        Boolean recoilOk = firstBoolean(payload, "recoilOk", "recoil_ok", "recoil", "depth_ok");
        Double pauseS = firstDouble(payload, "pauseS", "pause_s");
        Integer compressionCount = firstInt(payload, "compressionCount", "compression_count", "total_compressions", "valid_compression_count");
        String handPlacement = firstText(payload, "handPlacement", "hand_placement");
        Object flags = jsonValue(payload.get("flags"));
        if (flags == null) {
            flags = jsonValue(payload.get("quality_flags"));
        }
        String feedback = firstText(payload, "feedback");
        if (flags == null && feedback != null) {
            String mappedFlag = mapFeedbackToFlag(feedback);
            if (mappedFlag != null) {
                flags = mappedFlag;
                warnings.add("mapped legacy feedback to flags");
            } else {
                warnings.add("ignored unknown legacy feedback value");
            }
        }

        if (depthMm == null && rateCpm == null && recoilOk == null) {
            return TelemetryNormalizationResult.rejected("payload is missing required metric-first fields", warnings);
        }

        Object debugRaw = jsonValue(payload.get("debugRaw"));
        if (debugRaw == null && looksLikeFirmwareTelemetry(payload)) {
            debugRaw = jsonValue(payload);
        }

        LiveMetricPayload metric = new LiveMetricPayload(
                deviceId,
                firstText(payload, "manikinId", "manikin_id"),
                sessionId,
                firstLong(payload, "seq"),
                firstLong(payload, "tsMs", "ts_ms"),
                jsonValue(payload.get("timestamp")),
                depthMm,
                rateCpm,
                recoilOk,
                pauseS,
                compressionCount,
                handPlacement,
                flags,
                sourceMode,
                debugRaw
        );

        String rangeError = validateRanges(metric);
        if (rangeError != null) {
            return TelemetryNormalizationResult.rejected(rangeError, warnings);
        }

        return TelemetryNormalizationResult.accepted(metric, warnings);
    }

    private static String validateRanges(LiveMetricPayload metric) {
        if (metric.depthMm() != null && (metric.depthMm() < 0.0 || metric.depthMm() > 120.0)) {
            return "depthMm is outside the accepted range";
        }
        if (metric.rateCpm() != null && (metric.rateCpm() < 0.0 || metric.rateCpm() > 240.0)) {
            return "rateCpm is outside the accepted range";
        }
        if (metric.pauseS() != null && (metric.pauseS() < 0.0 || metric.pauseS() > 600.0)) {
            return "pauseS is outside the accepted range";
        }
        if (metric.compressionCount() != null && metric.compressionCount() < 0) {
            return "compressionCount cannot be negative";
        }
        if (metric.seq() != null && metric.seq() < 0) {
            return "seq cannot be negative";
        }
        return null;
    }

    private static String normalizeSourceMode(String value) {
        if (value == null) {
            return null;
        }
        String normalized = value.toLowerCase(Locale.ROOT);
        return switch (normalized) {
            case "real", "simulator", "calibration", "debug" -> normalized;
            default -> "debug";
        };
    }

    private static String mapFeedbackToFlag(String feedback) {
        String normalized = feedback.trim().toUpperCase(Locale.ROOT);
        return switch (normalized) {
            case "PERFECT", "OK", "GOOD", "NONE" -> "DEPTH_OK,RATE_OK,RECOIL_OK";
            case "TOO_SHALLOW", "SHALLOW", "DEPTH_LOW" -> "DEPTH_LOW";
            case "TOO_DEEP", "DEEP", "DEPTH_HIGH" -> "DEPTH_HIGH";
            case "TOO_SLOW", "SLOW", "RATE_SLOW" -> "RATE_SLOW";
            case "TOO_FAST", "FAST", "RATE_FAST" -> "RATE_FAST";
            case "BAD_RECOIL", "RECOIL_INCOMPLETE" -> "RECOIL_INCOMPLETE";
            case "PAUSE", "PAUSE_DETECTED" -> "PAUSE_DETECTED";
            case "HAND_PLACEMENT_WARNING", "BAD_HAND_PLACEMENT" -> "HAND_PLACEMENT_WARNING";
            default -> null;
        };
    }

    private static boolean looksLikeFirmwareTelemetry(JsonNode payload) {
        return payload.has("depth_progress")
                || payload.has("depthProgress")
                || payload.has("depth_ok")
                || payload.has("valid_compression_count")
                || payload.has("quality_flags")
                || payload.has("hand_placement")
                || payload.has("pressure_balance_pct");
    }

    private static String firstText(JsonNode payload, String... keys) {
        for (String key : keys) {
            JsonNode node = payload.get(key);
            if (node != null && node.isTextual()) {
                String value = node.asText().trim();
                if (!value.isEmpty()) {
                    return value;
                }
            }
        }
        return null;
    }

    private static Double firstDouble(JsonNode payload, String... keys) {
        for (String key : keys) {
            JsonNode node = payload.get(key);
            if (node != null && node.isNumber()) {
                return node.asDouble();
            }
        }
        return null;
    }

    private static Integer firstInt(JsonNode payload, String... keys) {
        for (String key : keys) {
            JsonNode node = payload.get(key);
            if (node != null && node.isNumber()) {
                return node.asInt();
            }
        }
        return null;
    }

    private static Long firstLong(JsonNode payload, String... keys) {
        for (String key : keys) {
            JsonNode node = payload.get(key);
            if (node != null && node.isNumber()) {
                return node.asLong();
            }
        }
        return null;
    }

    private static Boolean firstBoolean(JsonNode payload, String... keys) {
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

    record TelemetryNormalizationResult(boolean ok, LiveMetricPayload value, String reason, List<String> warnings) {
        private static TelemetryNormalizationResult accepted(LiveMetricPayload value, List<String> warnings) {
            return new TelemetryNormalizationResult(true, value, null, List.copyOf(warnings));
        }

        private static TelemetryNormalizationResult rejected(String reason, List<String> warnings) {
            return new TelemetryNormalizationResult(false, null, reason, List.copyOf(warnings));
        }
    }
}
