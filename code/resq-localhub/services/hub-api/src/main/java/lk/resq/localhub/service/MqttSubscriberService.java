package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.localhub.model.firmware.CalibrationMqttEvent;
import lk.resq.localhub.model.firmware.DeviceReadinessState;
import lk.resq.localhub.model.firmware.FirmwareCalibrationResultRecord;
import lk.resq.localhub.model.firmware.FirmwareDebugSnapshotRecord;
import lk.resq.localhub.model.firmware.FirmwareEventRecord;
import lk.resq.localhub.model.firmware.FirmwareTopics;
import lk.resq.localhub.model.firmware.CalibrationEventLog;
import lk.resq.localhub.model.firmware.CalibrationEvidence;
import lk.resq.localhub.model.firmware.SensorStreamSnapshot;
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
import java.util.Optional;
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
    private final RateEstimatorRegistry rateEstimatorRegistry;
    private final DeviceReadinessService deviceReadinessService;
    private final CalibrationStreamService calibrationStreamService;
    private final CalibrationPersistenceRepository calibrationPersistenceRepository;
    private final SensorStreamService sensorStreamService;

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
            RateEstimatorRegistry rateEstimatorRegistry,
            DeviceReadinessService deviceReadinessService,
            CalibrationStreamService calibrationStreamService,
            CalibrationPersistenceRepository calibrationPersistenceRepository,
            SensorStreamService sensorStreamService,
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
        this.rateEstimatorRegistry = rateEstimatorRegistry;
        this.deviceReadinessService = deviceReadinessService;
        this.calibrationStreamService = calibrationStreamService;
        this.calibrationPersistenceRepository = calibrationPersistenceRepository;
        this.sensorStreamService = sensorStreamService == null ? new SensorStreamService() : sensorStreamService;
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
            FirmwarePersistenceRepository firmwarePersistenceRepository,
            RateEstimatorRegistry rateEstimatorRegistry,
            DeviceReadinessService deviceReadinessService,
            CalibrationStreamService calibrationStreamService,
            CalibrationPersistenceRepository calibrationPersistenceRepository,
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
                firmwarePersistenceRepository,
                rateEstimatorRegistry,
                deviceReadinessService,
                calibrationStreamService,
                calibrationPersistenceRepository,
                new SensorStreamService(),
                brokerUrl,
                clientId,
                username,
                password
        );
    }

    public MqttSubscriberService(
            ObjectMapper objectMapper,
            ManikinRegistryService manikinRegistryService,
            ActiveSessionService activeSessionService,
            LiveStreamService liveStreamService,
            FirmwarePersistenceRepository firmwarePersistenceRepository,
            DeviceReadinessService deviceReadinessService,
            CalibrationStreamService calibrationStreamService,
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
                firmwarePersistenceRepository,
                new RateEstimatorRegistry(),
                deviceReadinessService,
                calibrationStreamService,
                null,
                new SensorStreamService(),
                brokerUrl,
                clientId,
                username,
                password
        );
    }

    public MqttSubscriberService(
            ObjectMapper objectMapper,
            ManikinRegistryService manikinRegistryService,
            ActiveSessionService activeSessionService,
            LiveStreamService liveStreamService,
            DeviceReadinessService deviceReadinessService,
            CalibrationStreamService calibrationStreamService,
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
                new RateEstimatorRegistry(),
                deviceReadinessService,
                calibrationStreamService,
                null,
                new SensorStreamService(),
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

    public boolean isMqttConnected() {
        return mqttClient != null && mqttClient.isConnected();
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
                    if (isSensorStreamTelemetry(payload)) {
                        SensorStreamSnapshot snapshot = sensorStreamService.parseSnapshot(parsedTopic.deviceId, payload, Instant.now());
                        manikinRegistryService.updateFromSensorStream(parsedTopic.deviceId, snapshot);
                        sensorStreamService.recordSnapshot(snapshot);
                        publishInstructorLiveSnapshot();
                        logger.info("Processed SENSOR_STREAM telemetry for {}", parsedTopic.deviceId);
                        return;
                    }

                    String telemetryMode = firstText(payload, "telemetry_mode", "telemetryMode");
                    if (telemetryMode != null) {
                        rejectedTelemetryCount.incrementAndGet();
                        logger.warn("Rejected unsupported telemetry_mode {} for device {}", telemetryMode, parsedTopic.deviceId);
                        return;
                    }

                    String payloadSessionId = firstText(payload, "sessionId", "session_id");
                    if (payloadSessionId == null) {
                        payloadSessionId = activeSessionService.findActiveSessionForDevice(parsedTopic.deviceId)
                                .map(lk.resq.localhub.model.ActiveSessionInfo::sessionId)
                                .orElse(null);
                    }

                    TelemetryPayloadNormalizer.TelemetryNormalizationResult normalization =
                            TelemetryPayloadNormalizer.normalize(payload, parsedTopic.deviceId, payloadSessionId, rateEstimatorRegistry);
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

                    String traineeId = activeSessionService.findActiveSessionForDevice(parsedTopic.deviceId)
                            .map(lk.resq.localhub.model.ActiveSessionInfo::traineeId)
                            .orElse("unknown");
                    logger.info(
                            "Processed telemetry: deviceId={}, sessionId={}, traineeId={}, rateCpm={}, compressionCount={}, streamTargets=[instructor SSE, trainee SSE (/api/stream/sessions/live/{})]",
                            parsedTopic.deviceId,
                            normalization.value().sessionId(),
                            traineeId,
                            normalization.value().rateCpm(),
                            normalization.value().compressionCount(),
                            normalization.value().sessionId()
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
                    CalibrationMqttEvent calEvent = parseCalibrationMqttEvent(parsedTopic.deviceId, payload);
                    if (calEvent != null) {
                        DeviceReadinessState readiness = deviceReadinessService.handleCalibrationEvent(parsedTopic.deviceId, calEvent);
                        calibrationStreamService.publishCalibrationUpdate(parsedTopic.deviceId, calEvent, readiness);
                        try {
                            if (calibrationPersistenceRepository != null) {
                                persistCalibrationEvent(parsedTopic.deviceId, calEvent, payloadText);
                            }
                        } catch (Exception error) {
                            logger.error("Failed to persist calibration event/evidence for device {}", parsedTopic.deviceId, error);
                        }
                    }
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
        String reasonId = normalizedReasonId(firstScalarAsText(payload, "reason_id", "reasonId"));
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

    private CalibrationMqttEvent parseCalibrationMqttEvent(String deviceId, JsonNode payload) {
        Integer eventId = integer(payload, "event_id", "eventId");
        String replyId = firstText(payload, "reply_id", "replyId");
        String status = firstText(payload, "status");
        Integer progressId = integer(payload, "progress_id", "progressId");
        String result = firstText(payload, "result");
        String reasonId = normalizedReasonId(firstScalarAsText(payload, "reason_id", "reasonId"));
        Integer actionId = integer(payload, "action_id", "actionId");
        String firmwareState = firstText(payload, "state");
        Long tsMs = longValue(payload, "ts_ms", "tsMs");
        Instant receivedAt = Instant.now();

        return new CalibrationMqttEvent(
                deviceId,
                eventId,
                replyId,
                status,
                progressId,
                result,
                reasonId,
                actionId,
                firmwareState,
                tsMs,
                receivedAt,
                doubleValue(payload, "pressure_0_kpa", "pressure0Kpa"),
                booleanValue(payload, "pressure_0_kpa_valid", "pressure0KpaValid"),
                doubleValue(payload, "pressure_1_kpa", "pressure1Kpa"),
                booleanValue(payload, "pressure_1_kpa_valid", "pressure1KpaValid"),
                doubleValue(payload, "pressure_2_kpa", "pressure2Kpa"),
                booleanValue(payload, "pressure_2_kpa_valid", "pressure2KpaValid"),
                booleanValue(payload, "pressure_kpa_valid", "pressureKpaValid"),
                doubleValue(payload, "hall_mm", "hallMm"),
                doubleValue(payload, "hall_progress", "hallProgress"),
                booleanValue(payload, "hall_mm_valid", "hallMmValid"),
                booleanValue(payload, "sample_pressure_kpa_valid", "samplePressureKpaValid"),
                booleanValue(payload, "sample_hall_mm_valid", "sampleHallMmValid"),
                integer(payload, "pressure_saturation_mask", "pressureSaturationMask"),
                doubleValue(payload, "full_depth_mm", "fullDepthMm")
        );
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
            case "PASS", "PASS_WITH_WARNINGS", "READY", "CALIBRATED" -> true;
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

    private static boolean isSensorStreamTelemetry(JsonNode payload) {
        String telemetryMode = firstText(payload, "telemetry_mode", "telemetryMode");
        return telemetryMode != null && "SENSOR_STREAM".equalsIgnoreCase(telemetryMode);
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

    private static String firstScalarAsText(JsonNode payload, String... keys) {
        if (payload == null) {
            return null;
        }

        for (String key : keys) {
            JsonNode node = payload.get(key);
            if (node == null || node.isNull()) {
                continue;
            }

            if (node.isTextual() || node.isNumber() || node.isBoolean()) {
                String value = node.asText().trim();
                if (!value.isEmpty()) {
                    return value;
                }
            }
        }

        return null;
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

    private static Double doubleValue(JsonNode payload, String... keys) {
        for (String key : keys) {
            JsonNode node = payload.get(key);
            if (node == null || node.isNull()) {
                continue;
            }

            if (node.isNumber()) {
                return node.asDouble();
            }

            if (node.isTextual()) {
                try {
                    return Double.parseDouble(node.asText().trim());
                } catch (NumberFormatException ignored) {
                }
            }
        }

        return null;
    }

    private static Boolean booleanValue(JsonNode payload, String... keys) {
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

    private void persistCalibrationEvent(String deviceId, CalibrationMqttEvent calEvent, String payloadText) {
        CalibrationEventLog eventLog = new CalibrationEventLog(
                null,
                deviceId,
                calEvent.replyId() != null && !calEvent.replyId().trim().isEmpty() ? calEvent.replyId() : calEvent.deviceId(),
                calEvent.eventId(),
                calEvent.progressId(),
                calEvent.result(),
                calEvent.status(),
                calEvent.reasonId(),
                calEvent.actionId(),
                calEvent.firmwareState(),
                calEvent.tsMs(),
                calEvent.receivedAt() != null ? calEvent.receivedAt() : Instant.now(),
                payloadText
        );
        calibrationPersistenceRepository.saveEventLog(eventLog);

        if (calEvent.eventId() != null) {
            Optional<CalibrationEvidence> matchingEvidenceOpt = Optional.empty();
            String matchRequestId = calEvent.replyId();
            if (matchRequestId != null && !matchRequestId.trim().isEmpty()) {
                matchingEvidenceOpt = calibrationPersistenceRepository.findEvidenceByRequestId(deviceId, matchRequestId);
            }
            if (matchingEvidenceOpt.isEmpty()) {
                matchingEvidenceOpt = calibrationPersistenceRepository.findLatestRunningEvidence(deviceId);
            }

            if (matchingEvidenceOpt.isPresent()) {
                CalibrationEvidence oldEvidence = matchingEvidenceOpt.get();
                String finalResult = oldEvidence.finalResult();
                Instant completedAt = oldEvidence.completedAt();
                Boolean readyAtCompletion = oldEvidence.readyForSessionAtCompletion();

                if (calEvent.eventId() == 4002) {
                    finalResult = calEvent.result() != null ? calEvent.result().toUpperCase(Locale.ROOT) : "FAIL";
                    completedAt = Instant.now();
                    readyAtCompletion = "PASS".equals(finalResult);
                } else if (calEvent.progressId() != null && calEvent.progressId() == 13) {
                    finalResult = "INTERRUPTED";
                    completedAt = Instant.now();
                    readyAtCompletion = false;
                }

                CalibrationEvidence updatedEvidence = new CalibrationEvidence(
                        oldEvidence.id(),
                        oldEvidence.deviceId(),
                        oldEvidence.requestId(),
                        oldEvidence.startedAt(),
                        completedAt,
                        finalResult,
                        calEvent.firmwareState() != null ? calEvent.firmwareState() : oldEvidence.calibrationState(),
                        readyAtCompletion,
                        calEvent.progressId() != null ? calEvent.progressId() : oldEvidence.lastProgressId(),
                        calEvent.reasonId() != null ? calEvent.reasonId() : oldEvidence.lastReasonId(),
                        calEvent.actionId() != null ? calEvent.actionId() : oldEvidence.lastActionId(),
                        calEvent.firmwareState() != null ? calEvent.firmwareState() : oldEvidence.firmwareState(),
                        oldEvidence.profileId(),
                        oldEvidence.hallDelta(),
                        oldEvidence.refPressure(),
                        oldEvidence.bladder1Pressure(),
                        oldEvidence.bladder2Pressure(),
                        oldEvidence.sampleIntervalMs(),
                        oldEvidence.calibrationWindowMs(),
                        oldEvidence.createdByUsername(),
                        oldEvidence.createdAt(),
                        Instant.now()
                );
                calibrationPersistenceRepository.updateEvidence(updatedEvidence);
            }
        }
    }

    record ParsedTopic(String deviceId, String messageType, boolean canonicalFirmwareTopic) {
    }
}
