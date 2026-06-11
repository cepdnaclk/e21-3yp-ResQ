package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.localhub.model.firmware.FirmwareCalibrationResultRecord;
import lk.resq.localhub.model.firmware.FirmwareDebugSnapshotRecord;
import lk.resq.localhub.model.firmware.FirmwareEventRecord;
import lk.resq.localhub.model.firmware.FirmwareTopics;
import org.eclipse.paho.client.mqttv3.IMqttDeliveryToken;
import org.eclipse.paho.client.mqttv3.MqttCallback;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

@Service
public class MqttSubscriberService {

    private static final Logger logger = LoggerFactory.getLogger(MqttSubscriberService.class);

    // Keep topic handling canonical in one place for this slice.
    private static final List<String> SUBSCRIPTIONS = List.of(
            FirmwareTopics.statusTopic("+"),
            FirmwareTopics.heartbeatTopic("+"),
            FirmwareTopics.telemetryTopic("+"),
            FirmwareTopics.debugTopic("+"),
            FirmwareTopics.eventsTopic("+"),
            FirmwareTopics.calibrationEventsTopic("+"),
            FirmwareTopics.errorEventsTopic("+"),
            "resq/manikins/+/status",
            "resq/manikins/+/heartbeat",
            "resq/manikins/+/telemetry",
            "resq/manikins/+/debug",
            "resq/manikins/+/events",
            "resq/manikins/+/events/calibration",
            "resq/manikins/+/events/error",
            "resq/manikins/+/live"
    );

    private final ObjectMapper objectMapper;
    private final ManikinRegistryService manikinRegistryService;
    private final ActiveSessionService activeSessionService;
    private final LiveStreamService liveStreamService;
    private final FirmwarePersistenceRepository firmwarePersistenceRepository;

    private final String brokerUrl;
    private final String clientId;
    private final String username;
    private final String password;

    private final AtomicBoolean running = new AtomicBoolean(false);
    private final AtomicLong acceptedTelemetryCount = new AtomicLong(0);
    private final AtomicLong rejectedTelemetryCount = new AtomicLong(0);
    private final ScheduledExecutorService reconnectExecutor = Executors.newSingleThreadScheduledExecutor();

    private MqttClient mqttClient;

    @Autowired
    public MqttSubscriberService(
            ObjectMapper objectMapper,
            ManikinRegistryService manikinRegistryService,
            ActiveSessionService activeSessionService,
            LiveStreamService liveStreamService,
            FirmwarePersistenceRepository firmwarePersistenceRepository,
            @Value("${resq.mqtt.broker-url:tcp://localhost:1883}") String brokerUrl,
            @Value("${resq.mqtt.client-id:hub-api-live-registry}") String clientId,
            @Value("${resq.mqtt.username:}") String username,
            @Value("${resq.mqtt.password:}") String password
    ) {
        this.objectMapper = objectMapper;
        this.manikinRegistryService = manikinRegistryService;
        this.activeSessionService = activeSessionService;
        this.liveStreamService = liveStreamService;
        this.firmwarePersistenceRepository = firmwarePersistenceRepository;
        this.brokerUrl = brokerUrl;
        this.clientId = clientId;
        this.username = normalize(username);
        this.password = password;
    }

    public MqttSubscriberService(
            ObjectMapper objectMapper,
            ManikinRegistryService manikinRegistryService,
            ActiveSessionService activeSessionService,
            LiveStreamService liveStreamService,
            String brokerUrl,
            String clientId,
            String username,
            String password
    ) {
        this(
                objectMapper,
                manikinRegistryService,
                activeSessionService,
                liveStreamService,
                defaultFirmwarePersistenceRepository(),
                brokerUrl,
                clientId,
                username,
                password
        );
        this.firmwarePersistenceRepository.initialize();
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
        applyCredentials(options);

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

    private void applyCredentials(MqttConnectOptions options) {
        if (username == null) {
            return;
        }

        options.setUserName(username);
        if (password != null && !password.isBlank()) {
            options.setPassword(password.toCharArray());
        }
    }

    void handleMessage(String topic, MqttMessage message) {
        ParsedTopic parsedTopic = parseTopic(topic);
        if (parsedTopic == null) {
            logger.debug("Ignored MQTT topic outside the firmware contract: {}", topic);
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
            if (parsedTopic.canonicalFirmwareTopic) {
                persistCanonicalMessage(topic, parsedTopic, payload);
            }

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
                    TelemetryPayloadNormalizer.TelemetryNormalizationResult normalization =
                            TelemetryPayloadNormalizer.normalize(payload, parsedTopic.deviceId);
                    if (!normalization.ok()) {
                        rejectedTelemetryCount.incrementAndGet();
                        logger.warn(
                                "Rejected session telemetry for device {} session {}: {}",
                                parsedTopic.deviceId,
                                text(payload, "session_id") != null
                                        ? text(payload, "session_id")
                                        : text(payload, "sessionId"),
                                normalization.reason()
                        );
                        return;
                    }

                    JsonNode normalizedPayload = objectMapper.valueToTree(normalization.value());
                    ActiveSessionService.TelemetryValidationResult validation =
                            activeSessionService.validateTelemetryBinding(parsedTopic.deviceId, payload);
                    if (!validation.accepted()) {
                        rejectedTelemetryCount.incrementAndGet();
                        logger.warn(
                                "Rejected session telemetry for device {} session {}: {}",
                                parsedTopic.deviceId,
                                normalization.value().sessionId(),
                                validation.reason()
                        );
                        return;
                    }

                    if (!normalization.warnings().isEmpty()) {
                        logger.info(
                                "Normalized MQTT telemetry for device {} session {} with warnings: {}",
                                validation.deviceId(),
                                validation.sessionId(),
                                normalization.warnings()
                        );
                    }

                    manikinRegistryService.updateFromTelemetry(parsedTopic.deviceId, normalizedPayload);
                    activeSessionService.recordTelemetry(parsedTopic.deviceId, normalizedPayload);
                    acceptedTelemetryCount.incrementAndGet();
                    publishInstructorLiveSnapshot();
                    logger.info(
                            "Accepted session telemetry deviceId={} sessionId={} tsMs={} compressionCount={} depthProgress={} rateCpm={} pressureBalancePct={}",
                            parsedTopic.deviceId,
                            validation.sessionId(),
                            normalization.value().tsMs(),
                            normalization.value().compressionCount(),
                            normalization.value().depthProgress(),
                            normalization.value().rateCpm(),
                            normalization.value().pressureBalancePct()
                    );
                }
                case "debug" -> {
                    manikinRegistryService.updateFromDebug(parsedTopic.deviceId, payload);
                    publishInstructorLiveSnapshot();
                    publishSessionLiveForPayload(payload);
                    logger.info("Processed MQTT debug message for {}", parsedTopic.deviceId);
                }
                case "events" -> {
                    manikinRegistryService.updateFromEvent(parsedTopic.deviceId, payload);
                    publishInstructorLiveSnapshot();
                    publishSessionLiveForPayload(payload);
                    logger.info("Processed MQTT event message for {}", parsedTopic.deviceId);
                }
                case "events/calibration" -> {
                    manikinRegistryService.updateFromCalibrationEvent(parsedTopic.deviceId, payload);
                    publishInstructorLiveSnapshot();
                    publishSessionLiveForPayload(payload);
                    logger.info("Processed MQTT calibration event for {}", parsedTopic.deviceId);
                }
                case "events/error" -> {
                    manikinRegistryService.updateFromErrorEvent(parsedTopic.deviceId, payload);
                    publishInstructorLiveSnapshot();
                    publishSessionLiveForPayload(payload);
                    logger.info("Processed MQTT error event for {}", parsedTopic.deviceId);
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

    private void persistCanonicalMessage(String topic, ParsedTopic parsedTopic, JsonNode payload) {
        String payloadJson = payload.toString();
        Instant receivedAt = Instant.now();
        Integer eventId = integer(payload, "event_id", "eventId");
        String replyId = firstText(payload, "reply_id", "replyId", "request_id", "requestId");
        String requestId = firstText(payload, "request_id", "requestId");
        String status = firstText(payload, "status");
        String result = firstText(payload, "result");
        String reasonId = firstText(payload, "reason_id", "reasonId");
        Integer actionId = integer(payload, "action_id", "actionId");
        Integer progressId = integer(payload, "progress_id", "progressId");
        String firmwareState = firstText(payload, "state");
        String sessionId = firstText(payload, "sessionId", "session_id");
        Long tsMs = longValue(payload, "ts_ms", "tsMs");

        if ("debug".equals(parsedTopic.messageType)) {
            firmwarePersistenceRepository.saveDebugSnapshot(new FirmwareDebugSnapshotRecord(
                    0L,
                    parsedTopic.deviceId,
                    requestId,
                    integer(payload, "pressure_0_raw", "pressure0Raw"),
                    integer(payload, "pressure_1_raw", "pressure1Raw"),
                    integer(payload, "pressure_2_raw", "pressure2Raw"),
                    integer(payload, "hall_raw", "hallRaw"),
                    tsMs,
                    receivedAt,
                    payloadJson
            ));
        } else {
            firmwarePersistenceRepository.saveFirmwareEvent(new FirmwareEventRecord(
                    0L,
                    parsedTopic.deviceId,
                    topic,
                    parsedTopic.messageType,
                    eventId,
                    replyId,
                    requestId,
                    status,
                    result,
                    reasonId,
                    actionId,
                    progressId,
                    firmwareState,
                    sessionId,
                    tsMs,
                    receivedAt,
                    payloadJson
            ));

            if ("events/calibration".equals(parsedTopic.messageType)) {
                firmwarePersistenceRepository.saveCalibrationResult(new FirmwareCalibrationResultRecord(
                        0L,
                        parsedTopic.deviceId,
                        firstText(payload, "profile_id", "profileId"),
                        requestId,
                        replyId,
                        eventId,
                        result,
                        status,
                        progressId,
                        reasonId,
                        actionId,
                        firmwareState,
                        calibrationState(result),
                        tsMs,
                        receivedAt,
                        payloadJson
                ));
            }
        }

        if (replyId != null) {
            boolean updated = firmwarePersistenceRepository.updateCommandFromReply(
                    replyId,
                    eventId,
                    status,
                    payloadJson,
                    reasonId,
                    actionId,
                    receivedAt
            );

            if (!updated) {
                logger.info("Observed firmware reply {} on {} but no matching command request was found", replyId, topic);
            }
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

    ParsedTopic parseTopic(String topic) {
        if (topic == null || topic.isBlank()) {
            return null;
        }

        String[] parts = topic.split("/");
        if (parts.length < 3 || !"resq".equals(parts[0])) {
            return null;
        }

        if ("manikins".equals(parts[1])) {
            if (parts.length < 4) {
                return null;
            }

            String deviceId = parts[2];
            if (deviceId == null || deviceId.isBlank()) {
                return null;
            }

            return parseMessageType(deviceId, parts, 3, false);
        }

        String deviceId = parts[1];
        if (deviceId == null || deviceId.isBlank()) {
            return null;
        }

        return parseMessageType(deviceId, parts, 2, true);
    }

    private ParsedTopic parseMessageType(String deviceId, String[] parts, int messageIndex, boolean canonicalFirmwareTopic) {
        if (parts.length <= messageIndex) {
            return null;
        }

        String kind = parts[messageIndex].toLowerCase(Locale.ROOT);
        String normalizedType = switch (kind) {
            case "status" -> "status";
            case "heartbeat" -> "heartbeat";
            case "telemetry" -> "telemetry";
            case "debug" -> "debug";
            case "events" -> {
                if (parts.length > messageIndex + 1) {
                    String subKind = parts[messageIndex + 1].toLowerCase(Locale.ROOT);
                    if ("calibration".equals(subKind)) {
                        yield "events/calibration";
                    }
                    if ("error".equals(subKind)) {
                        yield "events/error";
                    }
                }
                yield "events";
            }
            case "live" -> "telemetry";
            default -> null;
        };

        if (normalizedType == null) {
            return null;
        }

        return new ParsedTopic(deviceId, normalizedType, canonicalFirmwareTopic);
    }

    private static Boolean calibrationState(String result) {
        if (result == null) {
            return null;
        }

        String normalized = result.trim().toUpperCase(Locale.ROOT);
        return switch (normalized) {
            case "PASS", "READY", "CALIBRATED" -> true;
            case "FAIL", "FAILED", "CANCELLED", "CANCELED" -> false;
            default -> null;
        };
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

    private static String normalize(String value) {
        if (value == null) {
            return null;
        }

        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static String firstText(JsonNode payload, String... keys) {
        for (String key : keys) {
            String value = text(payload, key);
            if (value != null) {
                return value;
            }
        }

        return null;
    }

    private static FirmwarePersistenceRepository defaultFirmwarePersistenceRepository() {
        return new FirmwarePersistenceRepository(Path.of(System.getProperty("user.home"), ".resq-localhub", "hub-api.sqlite").toString());
    }

    private static Integer integer(JsonNode payload, String... keys) {
        for (String key : keys) {
            JsonNode node = payload.get(key);
            if (node == null || node.isNull()) {
                continue;
            }

            if (node.isInt() || node.isLong() || node.isIntegralNumber()) {
                return node.asInt();
            }

            if (node.isTextual()) {
                try {
                    return Integer.parseInt(node.asText().trim());
                } catch (NumberFormatException ignored) {
                }
            }
        }

        return null;
    }

    private static Long longValue(JsonNode payload, String... keys) {
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

    record ParsedTopic(String deviceId, String messageType, boolean canonicalFirmwareTopic) {
    }
}
