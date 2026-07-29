package lk.resq.localhub.model.ingestion;

import com.fasterxml.jackson.databind.JsonNode;

import java.time.Instant;

public record MqttIngestionEnvelope(
        String canonicalDeviceId,
        MqttTopicFamily topicFamily,
        String canonicalTopic,
        boolean legacyTopicUsed,
        TelemetryMode telemetryMode,
        Long firmwareTimestampMs,
        Instant backendReceivedAt,
        String bootId,
        Long stateSequence,
        String sessionId,
        JsonNode normalizedPayload,
        IngestionValidationResult validationResult
) {
}
