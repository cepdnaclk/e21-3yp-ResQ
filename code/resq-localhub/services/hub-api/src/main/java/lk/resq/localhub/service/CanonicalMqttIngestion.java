package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.localhub.model.ingestion.IngestionValidationResult;
import lk.resq.localhub.model.ingestion.MqttIngestionEnvelope;
import lk.resq.localhub.model.ingestion.MqttTopicFamily;
import lk.resq.localhub.model.ingestion.TelemetryMode;

import java.time.Clock;
import java.time.Instant;
import java.util.Locale;

final class CanonicalMqttIngestion {
    private final ObjectMapper objectMapper;
    private final Clock clock;

    CanonicalMqttIngestion(ObjectMapper objectMapper) {
        this(objectMapper, Clock.systemUTC());
    }

    CanonicalMqttIngestion(ObjectMapper objectMapper, Clock clock) {
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    ParseResult parse(String topic, byte[] payloadBytes) {
        ParsedTopic parsedTopic = parseTopic(topic);
        if (parsedTopic == null) {
            return ParseResult.rejected("MALFORMED_TOPIC", "topic is outside the firmware contract");
        }

        JsonNode payload;
        try {
            payload = objectMapper.readTree(payloadBytes);
        } catch (Exception error) {
            return ParseResult.rejected("MALFORMED_JSON", "payload is not valid JSON");
        }
        if (payload == null || !payload.isObject()) {
            return ParseResult.rejected("MALFORMED_JSON", "payload must be a JSON object");
        }

        Instant receivedAt = clock.instant();
        MqttIngestionEnvelope envelope = new MqttIngestionEnvelope(
                parsedTopic.deviceId(),
                parsedTopic.family(),
                canonicalTopic(parsedTopic.deviceId(), parsedTopic.family()),
                parsedTopic.legacy(),
                classify(parsedTopic.family(), payload),
                firstLong(payload, "ts_ms", "tsMs"),
                receivedAt,
                firstText(payload, "boot_id", "bootId"),
                firstLong(payload, "state_seq", "stateSeq"),
                firstText(payload, "session_id", "sessionId"),
                payload.deepCopy(),
                IngestionValidationResult.valid()
        );
        return ParseResult.accepted(envelope);
    }

    ParsedTopic parseTopic(String topic) {
        if (topic == null || topic.isBlank()) {
            return null;
        }

        String[] parts = topic.split("/", -1);
        if (parts.length < 3 || !"resq".equals(parts[0])) {
            return null;
        }

        boolean legacy = "manikins".equals(parts[1]);
        int deviceIndex = legacy ? 2 : 1;
        int familyIndex = legacy ? 3 : 2;
        if (parts.length <= familyIndex || parts[deviceIndex].isBlank()) {
            return null;
        }

        MqttTopicFamily family = family(parts, familyIndex);
        return family == null ? null : new ParsedTopic(parts[deviceIndex].trim(), family, legacy);
    }

    private static MqttTopicFamily family(String[] parts, int familyIndex) {
        String kind = parts[familyIndex].toLowerCase(Locale.ROOT);
        if ("events".equals(kind)) {
            if (parts.length == familyIndex + 1) {
                return MqttTopicFamily.EVENT;
            }
            if (parts.length != familyIndex + 2) {
                return null;
            }
            return switch (parts[familyIndex + 1].toLowerCase(Locale.ROOT)) {
                case "calibration" -> MqttTopicFamily.CALIBRATION_EVENT;
                case "error" -> MqttTopicFamily.ERROR_EVENT;
                default -> null;
            };
        }
        if (parts.length != familyIndex + 1) {
            return null;
        }
        return switch (kind) {
            case "status" -> MqttTopicFamily.STATUS;
            case "heartbeat" -> MqttTopicFamily.HEARTBEAT;
            case "telemetry", "live" -> MqttTopicFamily.TELEMETRY;
            case "debug" -> MqttTopicFamily.DEBUG;
            default -> null;
        };
    }

    private static TelemetryMode classify(MqttTopicFamily family, JsonNode payload) {
        return switch (family) {
            case STATUS -> TelemetryMode.STATUS;
            case HEARTBEAT -> TelemetryMode.HEARTBEAT;
            case DEBUG -> TelemetryMode.DEBUG;
            case EVENT -> TelemetryMode.EVENT;
            case CALIBRATION_EVENT -> TelemetryMode.CALIBRATION;
            case ERROR_EVENT -> TelemetryMode.ERROR;
            case TELEMETRY -> telemetryMode(payload);
        };
    }

    private static TelemetryMode telemetryMode(JsonNode payload) {
        String marker = firstText(payload, "telemetry_mode", "telemetryMode");
        if (marker == null) {
            marker = firstText(payload, "state");
        }
        if (marker == null) {
            return TelemetryMode.UNKNOWN;
        }
        return switch (marker.trim().toUpperCase(Locale.ROOT)) {
            case "SESSION_ACTIVE" -> TelemetryMode.SESSION_ACTIVE;
            case "SENSOR_STREAM" -> TelemetryMode.SENSOR_STREAM;
            case "DEBUG" -> TelemetryMode.DEBUG;
            case "CALIBRATION", "CALIBRATING" -> TelemetryMode.CALIBRATION;
            default -> TelemetryMode.UNKNOWN;
        };
    }

    private static String canonicalTopic(String deviceId, MqttTopicFamily family) {
        return "resq/" + deviceId + "/" + family.canonicalSuffix();
    }

    private static String firstText(JsonNode payload, String... keys) {
        for (String key : keys) {
            JsonNode value = payload.get(key);
            if (value != null && !value.isNull() && value.isValueNode()) {
                String text = value.asText().trim();
                if (!text.isEmpty()) {
                    return text;
                }
            }
        }
        return null;
    }

    private static Long firstLong(JsonNode payload, String... keys) {
        for (String key : keys) {
            JsonNode value = payload.get(key);
            if (value == null || value.isNull()) {
                continue;
            }
            if (value.isIntegralNumber()) {
                return value.longValue();
            }
            if (value.isTextual()) {
                try {
                    return Long.parseLong(value.asText().trim());
                } catch (NumberFormatException ignored) {
                    return null;
                }
            }
        }
        return null;
    }

    record ParsedTopic(String deviceId, MqttTopicFamily family, boolean legacy) {
    }

    record ParseResult(
            MqttIngestionEnvelope envelope,
            IngestionValidationResult validationResult
    ) {
        static ParseResult accepted(MqttIngestionEnvelope envelope) {
            return new ParseResult(envelope, envelope.validationResult());
        }

        static ParseResult rejected(String reasonCode, String detail) {
            return new ParseResult(null, IngestionValidationResult.rejected(reasonCode, detail));
        }

        boolean accepted() {
            return envelope != null && validationResult.accepted();
        }
    }
}
