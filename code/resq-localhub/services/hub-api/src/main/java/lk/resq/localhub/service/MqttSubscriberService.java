package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.eclipse.paho.client.mqttv3.IMqttDeliveryToken;
import org.eclipse.paho.client.mqttv3.MqttCallback;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

@Service
public class MqttSubscriberService {

    private static final Logger logger = LoggerFactory.getLogger(MqttSubscriberService.class);

    // Keep topic handling canonical in one place for this slice.
    private static final List<String> SUBSCRIPTIONS = List.of(
            "resq/manikins/+/status",
            "resq/manikins/+/heartbeat",
            "resq/manikins/+/telemetry",
            "resq/manikins/+/events",
            "resq/manikins/+/live"
    );

    private final ObjectMapper objectMapper;
    private final ManikinRegistryService manikinRegistryService;
    private final ActiveSessionService activeSessionService;
    private final LiveStreamService liveStreamService;

    private final String brokerUrl;
    private final String clientId;

    private final AtomicBoolean running = new AtomicBoolean(false);
    private final ScheduledExecutorService reconnectExecutor = Executors.newSingleThreadScheduledExecutor();

    private MqttClient mqttClient;

    public MqttSubscriberService(
            ObjectMapper objectMapper,
            ManikinRegistryService manikinRegistryService,
            ActiveSessionService activeSessionService,
            LiveStreamService liveStreamService,
            @Value("${resq.mqtt.broker-url:tcp://localhost:1883}") String brokerUrl,
            @Value("${resq.mqtt.client-id:hub-api-live-registry}") String clientId
    ) {
        this.objectMapper = objectMapper;
        this.manikinRegistryService = manikinRegistryService;
        this.activeSessionService = activeSessionService;
        this.liveStreamService = liveStreamService;
        this.brokerUrl = brokerUrl;
        this.clientId = clientId;
    }

    @PostConstruct
    public void start() {
        running.set(true);

        // Small retry loop: if broker starts after the API, keep retrying.
        reconnectExecutor.scheduleWithFixedDelay(this::ensureConnected, 0, 5, TimeUnit.SECONDS);
    }

    @PreDestroy
    public void stop() {
        running.set(false);
        reconnectExecutor.shutdownNow();

        if (mqttClient == null) {
            return;
        }

        try {
            if (mqttClient.isConnected()) {
                mqttClient.disconnect();
            }
            mqttClient.close();
            logger.info("MQTT subscriber disconnected");
        } catch (MqttException error) {
            logger.warn("Error while closing MQTT subscriber", error);
        }
    }

    private void ensureConnected() {
        if (!running.get()) {
            return;
        }

        try {
            if (mqttClient != null && mqttClient.isConnected()) {
                return;
            }

            connectAndSubscribe();
        } catch (Exception error) {
            logger.warn("MQTT subscriber connect attempt failed. Will retry in 5s.", error);
        }
    }

    private synchronized void connectAndSubscribe() throws MqttException {
        if (mqttClient != null && mqttClient.isConnected()) {
            return;
        }

        String resolvedClientId = clientId + "-" + System.currentTimeMillis();

        if (mqttClient != null) {
            try {
                mqttClient.close();
            } catch (MqttException error) {
                logger.debug("Failed to close previous MQTT client before reconnect", error);
            }
        }

        mqttClient = new MqttClient(brokerUrl, resolvedClientId, new MemoryPersistence());

        MqttConnectOptions options = new MqttConnectOptions();
        options.setCleanSession(true);
        options.setAutomaticReconnect(true);
        options.setConnectionTimeout(5);

        mqttClient.setCallback(new MqttCallback() {
            @Override
            public void connectionLost(Throwable cause) {
                logger.warn("MQTT connection lost", cause);
            }

            @Override
            public void messageArrived(String topic, MqttMessage message) {
                handleMessage(topic, message);
            }

            @Override
            public void deliveryComplete(IMqttDeliveryToken token) {
                // No-op: subscriber only.
            }
        });

        mqttClient.connect(options);
        logger.info("MQTT subscriber connected to {}", brokerUrl);

        for (String topicFilter : SUBSCRIPTIONS) {
            mqttClient.subscribe(topicFilter, 0);
            logger.info("MQTT subscriber subscribed to {}", topicFilter);
        }

        logger.info("MQTT subscriber subscribed to {} topic patterns", SUBSCRIPTIONS.size());
    }

    private void handleMessage(String topic, MqttMessage message) {
        ParsedTopic parsedTopic = parseTopic(topic);
        if (parsedTopic == null) {
            return;
        }

        String payloadText = new String(message.getPayload(), StandardCharsets.UTF_8);

        JsonNode payload;
        try {
            payload = parsePayload(payloadText, topic);
        } catch (Exception error) {
            logger.warn(
                    "Invalid MQTT JSON payload on topic {}. Raw payload: {}. Error message: {}",
                    topic,
                    payloadText,
                    error.getMessage(),
                    error
            );
            return;
        }

        try {
            switch (parsedTopic.messageType) {
                case "status" -> {
                    manikinRegistryService.updateFromStatus(parsedTopic.deviceId, payload);
                    publishInstructorLiveSnapshot();
                    publishSessionLiveForPayload(payload);
                    logger.info("Processed MQTT status message for {}", parsedTopic.deviceId);
                }
                case "heartbeat" -> {
                    manikinRegistryService.updateFromHeartbeat(parsedTopic.deviceId, payload);
                    publishInstructorLiveSnapshot();
                    publishSessionLiveForPayload(payload);
                    logger.info("Processed MQTT heartbeat message for {}", parsedTopic.deviceId);
                }
                case "telemetry" -> {
                    try {
                        manikinRegistryService.updateFromTelemetry(parsedTopic.deviceId, payload);
                    } catch (RuntimeException error) {
                        logger.warn(
                                "Failed to update live registry from telemetry for {}. Continuing with session accumulator update.",
                                parsedTopic.deviceId,
                                error
                        );
                    }

                    // Bridge telemetry into active-session summary accumulation for the same device.
                    activeSessionService.recordTelemetry(parsedTopic.deviceId, payload);
                    publishInstructorLiveSnapshot();
                    publishSessionLiveForDevice(parsedTopic.deviceId);
                    publishSessionLiveForPayload(payload);
                    logger.info("Processed MQTT telemetry message for {} and forwarded to active-session accumulator", parsedTopic.deviceId);
                }
                case "events" -> {
                    manikinRegistryService.updateFromEvent(parsedTopic.deviceId, payload);
                    publishInstructorLiveSnapshot();
                    publishSessionLiveForPayload(payload);
                    logger.info("Processed MQTT event message for {}", parsedTopic.deviceId);
                }
                default -> {
                    // Ignore unknown messages.
                }
            }
        } catch (Exception error) {
            logger.warn(
                    "Failed to process MQTT payload on topic {}. Raw payload: {}. Error message: {}",
                    topic,
                    payloadText,
                    error.getMessage(),
                    error
            );
        }
    }

    private JsonNode parsePayload(String payloadText, String topic) throws Exception {
        try {
            return objectMapper.readTree(payloadText);
        } catch (Exception strictError) {
            String normalized = normalizeLooseJson(payloadText);

            if (normalized.equals(payloadText)) {
                throw strictError;
            }

            try {
                JsonNode payload = objectMapper.readTree(normalized);
                logger.warn("Accepted non-strict telemetry payload on topic {} after lightweight normalization", topic);
                return payload;
            } catch (Exception normalizedError) {
                throw strictError;
            }
        }
    }

    private String normalizeLooseJson(String raw) {
        if (raw == null) {
            return "";
        }

        String normalized = raw.trim();

        // Quote unquoted object keys: {depth_mm:50} -> {"depth_mm":50}
        normalized = normalized.replaceAll("([\\{,]\\s*)([A-Za-z_][A-Za-z0-9_]*)\\s*:", "$1\"$2\":");

        // Quote bareword items inside arrays: [DEPTH_OK,RATE_OK] -> ["DEPTH_OK","RATE_OK"]
        normalized = normalized.replaceAll("([\\[,])\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*(?=[,\\]])", "$1\"$2\"");

        return normalized;
    }

    private ParsedTopic parseTopic(String topic) {
        // Expected structure: resq/manikins/{deviceId}/{kind}
        String[] parts = topic.split("/");
        if (parts.length != 4) {
            return null;
        }

        if (!"resq".equals(parts[0]) || !"manikins".equals(parts[1])) {
            return null;
        }

        String deviceId = parts[2];
        if (deviceId == null || deviceId.isBlank()) {
            return null;
        }

        String kind = parts[3].toLowerCase(Locale.ROOT);
        String normalizedType = switch (kind) {
            case "status" -> "status";
            case "heartbeat" -> "heartbeat";
            case "telemetry" -> "telemetry";
            case "events" -> "events";
            case "live" -> "telemetry"; // Compatibility: treat /live as telemetry.
            default -> null;
        };

        if (normalizedType == null) {
            return null;
        }

        return new ParsedTopic(deviceId, normalizedType);
    }

    private void publishInstructorLiveSnapshot() {
        liveStreamService.publishInstructorLive(
                manikinRegistryService.getLiveSummaries().stream()
                        .map(activeSessionService::decorateLiveSummary)
                        .toList()
        );
    }

    private void publishSessionLiveForDevice(String deviceId) {
        activeSessionService.findActiveSessionForDevice(deviceId)
                .flatMap(info -> activeSessionService.getSessionLiveView(info.sessionId()))
                .ifPresent(view -> liveStreamService.publishSessionLive(view.sessionId(), view));
    }

    private void publishSessionLiveForPayload(JsonNode payload) {
        String sessionId = text(payload, "sessionId");
        if (sessionId == null) {
            sessionId = text(payload, "session_id");
        }

        if (sessionId == null) {
            return;
        }

        String resolvedSessionId = sessionId;
        activeSessionService.getSessionLiveView(resolvedSessionId)
                .or(() -> manikinRegistryService.getSessionLiveView(resolvedSessionId))
                .ifPresent(view -> liveStreamService.publishSessionLive(resolvedSessionId, view));
    }

    private static String text(JsonNode payload, String key) {
        if (payload == null) {
            return null;
        }

        JsonNode node = payload.get(key);
        if (node == null || node.isNull()) {
            return null;
        }

        String value = node.asText().trim();
        return value.isEmpty() ? null : value;
    }

    private record ParsedTopic(String deviceId, String messageType) {
    }
}
