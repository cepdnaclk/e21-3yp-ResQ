package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.JsonNode;
import lk.resq.localhub.model.LiveMetricPayload;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

final class TelemetryPayloadNormalizer {

    private TelemetryPayloadNormalizer() {
    }

    static TelemetryNormalizationResult normalize(JsonNode payload) {
        return normalize(payload, null, null, null);
    }

    static TelemetryNormalizationResult normalize(JsonNode payload, String topicDeviceId) {
        return normalize(payload, topicDeviceId, null, null);
    }

    static TelemetryNormalizationResult normalize(JsonNode payload, String topicDeviceId, String fallbackSessionId, RateEstimatorRegistry rateEstimatorRegistry) {
        List<String> warnings = new ArrayList<>();
        if (payload == null || !payload.isObject()) {
            return TelemetryNormalizationResult.rejected("payload must be a JSON object", warnings);
        }

        String payloadDeviceId = firstText(payload, "deviceId", "device_id");
        String normalizedTopicDeviceId = normalizeText(topicDeviceId);
        if (payloadDeviceId != null && normalizedTopicDeviceId != null && !payloadDeviceId.equals(normalizedTopicDeviceId)) {
            return TelemetryNormalizationResult.rejected("payload deviceId does not match MQTT topic deviceId", warnings);
        }

        String deviceId = payloadDeviceId != null ? payloadDeviceId : normalizedTopicDeviceId;
        String sessionId = firstText(payload, "sessionId", "session_id");
        if (sessionId == null) {
            sessionId = fallbackSessionId;
        }
        if (deviceId == null) {
            return TelemetryNormalizationResult.rejected("payload deviceId is missing", warnings);
        }
        if (sessionId == null) {
            return TelemetryNormalizationResult.rejected("payload sessionId is missing", warnings);
        }

        Boolean depthMmValid = firstBoolean(payload, "depthMmValid", "depth_mm_valid");
        Double depthMm = firstDouble(payload, "depthMm", "depth_mm");
        Double depthProgress = firstDouble(payload, "depthProgress", "depth_progress");
        String sourceMode = normalizeSourceMode(firstText(payload, "sourceMode", "source_mode", "depthSource", "depth_source", "mode"));

        Double rateCpm = firstDouble(payload, "rateCpm", "rate_cpm");

        Boolean depthOk = firstBoolean(payload, "depthOk", "depth_ok");
        Boolean recoilOk = firstBoolean(payload, "recoilOk", "recoil_ok", "recoil");
        Double recoilPct = firstDouble(payload, "recoilPct", "recoil_pct");
        Double pauseS = firstDouble(payload, "pauseS", "pause_s");
        if (depthMm == null && !Boolean.FALSE.equals(depthMmValid)) {
            depthMm = firstDouble(payload, "current_delta", "currentDelta");
            if (depthMm != null) {
                warnings.add("used raw current_delta/currentDelta as fallback depthMm");
                if (sourceMode == null || "real".equals(sourceMode)) {
                    sourceMode = "simulator";
                }
            } else if (depthProgress != null) {
                depthMm = depthProgress * 50.0;
                warnings.add("derived depthMm = depthProgress * 50.0 because depthMm is missing");
            }
        }

        Integer compressionCount = firstInt(payload, "compressionCount", "compression_count", "total_compressions", "totalCompressions");
        Integer completedCompressionCount = firstInt(
                payload,
                "completedCompressionCount",
                "completed_compression_count"
        );
        Integer depthOkCompressionCount = firstInt(
                payload,
                "depthOkCompressionCount",
                "depth_ok_compression_count"
        );
        Integer validCompressionCount = firstInt(payload, "validCompressionCount", "valid_compression_count");
        Double lastCompressionPeakDepthMm = firstDouble(
                payload,
                "lastCompressionPeakDepthMm",
                "last_compression_peak_depth_mm",
                "lastCompressionDepthMm",
                "last_compression_depth_mm"
        );
        Double averageCompletedCompressionPeakDepthMm = firstDouble(
                payload,
                "averageCompletedCompressionPeakDepthMm",
                "average_completed_compression_peak_depth_mm",
                "averageCompressionDepthMm",
                "average_compression_depth_mm"
        );
        Integer recoilOkCount = firstInt(payload, "recoilOkCount", "recoil_ok_count");
        Integer incompleteRecoilCount = firstInt(payload, "incompleteRecoilCount", "incomplete_recoil_count");
        String handPlacement = firstText(payload, "handPlacement", "hand_placement");
        Double canonicalPressureBalanceScorePct = firstDouble(
                payload,
                "pressureBalanceScorePct",
                "pressure_balance_score_pct"
        );
        Double legacyPressureBalanceScorePct = firstDouble(
                payload,
                "pressureBalancePct",
                "pressure_balance_pct"
        );
        if (canonicalPressureBalanceScorePct != null
                && legacyPressureBalanceScorePct != null
                && Math.abs(canonicalPressureBalanceScorePct - legacyPressureBalanceScorePct) > 0.0100001) {
            return TelemetryNormalizationResult.rejected(
                    "pressure balance canonical field conflicts with legacy alias",
                    warnings
            );
        }
        Double pressureBalanceScorePct = canonicalPressureBalanceScorePct != null
                ? canonicalPressureBalanceScorePct
                : legacyPressureBalanceScorePct;
        if (canonicalPressureBalanceScorePct == null && legacyPressureBalanceScorePct != null) {
            warnings.add("normalized legacy pressure_balance_pct alias");
        }
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

        String contradiction = metricContradiction(depthOk, recoilOk, pauseS, handPlacement, flags);
        if (contradiction != null) {
            return TelemetryNormalizationResult.rejectedContradiction(contradiction, warnings);
        }

        if (depthMm == null && depthProgress == null && depthOk == null && rateCpm == null
                && recoilOk == null && recoilPct == null) {
            return TelemetryNormalizationResult.rejected("payload is missing required metric-first fields", warnings);
        }

        if (isInvalidRate(rateCpm) && rateEstimatorRegistry != null) {
            rateCpm = rateEstimatorRegistry.getOrEstimateRate(deviceId, sessionId, depthProgress, depthMm, firstLong(payload, "tsMs", "ts_ms"), rateCpm);
        } else if (rateEstimatorRegistry != null) {
            rateEstimatorRegistry.getOrEstimateRate(deviceId, sessionId, depthProgress, depthMm, firstLong(payload, "tsMs", "ts_ms"), rateCpm);
        }

        LiveMetricPayload metric = new LiveMetricPayload(
                deviceId,
                firstText(payload, "manikinId", "manikin_id"),
                sessionId,
                firstLong(payload, "seq"),
                firstLong(payload, "tsMs", "ts_ms"),
                jsonValue(payload.get("timestamp")),
                depthMm,
                depthProgress,
                depthOk,
                rateCpm,
                recoilOk,
                recoilPct,
                pauseS,
                compressionCount,
                completedCompressionCount,
                depthOkCompressionCount,
                validCompressionCount,
                lastCompressionPeakDepthMm,
                averageCompletedCompressionPeakDepthMm,
                recoilOkCount,
                incompleteRecoilCount,
                handPlacement,
                flags,
                pressureBalanceScorePct,
                sourceMode
        );

        String rangeError = validateRanges(metric);
        if (rangeError != null) {
            return TelemetryNormalizationResult.rejected(rangeError, warnings);
        }

        MetricConsistency consistency = flags == null
                ? MetricConsistency.VALID
                : MetricConsistency.VALID_WITH_LEGACY_FLAGS;
        return TelemetryNormalizationResult.accepted(metric, warnings, consistency);
    }

    private static boolean isInvalidRate(Double rate) {
        return rate == null || rate == 0.0 || rate.isNaN() || rate < 0.0 || rate > 240.0;
    }

    private static String validateRanges(LiveMetricPayload metric) {
        if (metric.depthMm() != null && (metric.depthMm() < 0.0 || metric.depthMm() > 120.0)) {
            return "depthMm is outside the accepted range";
        }
        if (metric.depthProgress() != null && (metric.depthProgress() < 0.0 || metric.depthProgress() > 1.0)) {
            return "depthProgress is outside the accepted range";
        }
        if (metric.rateCpm() != null && (metric.rateCpm() < 0.0 || metric.rateCpm() > 240.0)) {
            return "rateCpm is outside the accepted range";
        }
        if (metric.pauseS() != null && (metric.pauseS() < 0.0 || metric.pauseS() > 600.0)) {
            return "pauseS is outside the accepted range";
        }
        if (metric.recoilPct() != null
                && (metric.recoilPct().isNaN()
                || metric.recoilPct().isInfinite()
                || metric.recoilPct() < 0.0
                || metric.recoilPct() > 100.0)) {
            return "recoilPct is outside the accepted range";
        }
        if (metric.compressionCount() != null && metric.compressionCount() < 0) {
            return "compressionCount cannot be negative";
        }
        if (metric.completedCompressionCount() != null
                && metric.completedCompressionCount() < 0) {
            return "completedCompressionCount cannot be negative";
        }
        if (metric.depthOkCompressionCount() != null
                && metric.depthOkCompressionCount() < 0) {
            return "depthOkCompressionCount cannot be negative";
        }
        if (metric.validCompressionCount() != null && metric.validCompressionCount() < 0) {
            return "validCompressionCount cannot be negative";
        }
        if (metric.lastCompressionPeakDepthMm() != null
                && (metric.lastCompressionPeakDepthMm() < 0.0
                || metric.lastCompressionPeakDepthMm() > 120.0)) {
            return "lastCompressionPeakDepthMm is outside the accepted range";
        }
        if (metric.averageCompletedCompressionPeakDepthMm() != null
                && (metric.averageCompletedCompressionPeakDepthMm() < 0.0
                || metric.averageCompletedCompressionPeakDepthMm() > 120.0)) {
            return "averageCompletedCompressionPeakDepthMm is outside the accepted range";
        }
        if (metric.recoilOkCount() != null && metric.recoilOkCount() < 0) {
            return "recoilOkCount cannot be negative";
        }
        if (metric.incompleteRecoilCount() != null && metric.incompleteRecoilCount() < 0) {
            return "incompleteRecoilCount cannot be negative";
        }
        if (metric.pressureBalanceScorePct() != null
                && (metric.pressureBalanceScorePct() < 0.0 || metric.pressureBalanceScorePct() > 100.0)) {
            return "pressureBalanceScorePct is outside the accepted range";
        }
        if (metric.seq() != null && metric.seq() < 0) {
            return "seq cannot be negative";
        }
        return null;
    }

    private static String normalizeText(String value) {
        if (value == null) {
            return null;
        }

        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static String normalizeSourceMode(String value) {
        if (value == null) {
            return null;
        }
        String normalized = value.toLowerCase(Locale.ROOT);
        return switch (normalized) {
            case "real", "simulator", "calibration", "debug", "hall" -> normalized;
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

    private static String metricContradiction(
            Boolean depthOk,
            Boolean recoilOk,
            Double pauseS,
            String handPlacement,
            Object flags
    ) {
        Set<String> values = flagSet(flags);
        if (Boolean.FALSE.equals(depthOk) && values.contains("DEPTH_OK")) {
            return "depth_ok=false contradicts DEPTH_OK";
        }
        if (Boolean.TRUE.equals(depthOk)
                && (values.contains("DEPTH_LOW") || values.contains("DEPTH_HIGH"))) {
            return "depth_ok=true contradicts a depth failure flag";
        }
        if (Boolean.FALSE.equals(recoilOk) && values.contains("RECOIL_OK")) {
            return "recoil_ok=false contradicts RECOIL_OK";
        }
        if (Boolean.TRUE.equals(recoilOk) && values.contains("RECOIL_INCOMPLETE")) {
            return "recoil_ok=true contradicts RECOIL_INCOMPLETE";
        }
        if (pauseS != null && pauseS <= 0.0 && values.contains("PAUSE_DETECTED")) {
            return "pause_s indicates no pause but flags contains PAUSE_DETECTED";
        }
        if ("CENTER".equalsIgnoreCase(handPlacement) && values.contains("HAND_PLACEMENT_WARNING")) {
            return "centered hand placement contradicts HAND_PLACEMENT_WARNING";
        }
        return null;
    }

    private static Set<String> flagSet(Object flags) {
        Set<String> values = new HashSet<>();
        if (flags == null) {
            return values;
        }
        if (flags instanceof String string) {
            for (String value : string.split(",")) {
                addFlag(values, value);
            }
            return values;
        }
        if (flags instanceof JsonNode node && node.isArray()) {
            node.forEach(value -> addFlag(values, value.asText()));
            return values;
        }
        if (flags instanceof Collection<?> collection) {
            collection.forEach(value -> addFlag(values, String.valueOf(value)));
        }
        return values;
    }

    private static void addFlag(Set<String> values, String value) {
        if (value != null && !value.isBlank()) {
            values.add(value.trim().toUpperCase(Locale.ROOT));
        }
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

    enum MetricConsistency {
        VALID,
        VALID_WITH_LEGACY_FLAGS,
        INVALID_CONTRADICTORY_METRICS
    }

    record TelemetryNormalizationResult(
            boolean ok,
            LiveMetricPayload value,
            String reason,
            List<String> warnings,
            MetricConsistency consistency
    ) {
        private static TelemetryNormalizationResult accepted(
                LiveMetricPayload value,
                List<String> warnings,
                MetricConsistency consistency
        ) {
            return new TelemetryNormalizationResult(true, value, null, List.copyOf(warnings), consistency);
        }

        private static TelemetryNormalizationResult rejected(String reason, List<String> warnings) {
            return new TelemetryNormalizationResult(false, null, reason, List.copyOf(warnings), null);
        }

        private static TelemetryNormalizationResult rejectedContradiction(String reason, List<String> warnings) {
            return new TelemetryNormalizationResult(
                    false,
                    null,
                    reason,
                    List.copyOf(warnings),
                    MetricConsistency.INVALID_CONTRADICTORY_METRICS
            );
        }
    }
}
