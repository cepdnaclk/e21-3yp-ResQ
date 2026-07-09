package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.localhub.model.SessionStartCommandPayload;
import lk.resq.localhub.model.SessionStopCommandPayload;
import lk.resq.localhub.model.firmware.CalibrationStartRequest;
import lk.resq.localhub.model.firmware.FirmwareCommandRequestRecord;
import lk.resq.localhub.model.firmware.FirmwareCommandTypeId;
import lk.resq.localhub.model.firmware.FirmwareRequestIds;
import lk.resq.localhub.model.firmware.FirmwareTopics;
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
import java.time.Instant;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.nio.file.Path;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

@Service
public class MqttCommandPublisherService {

    private static final Logger logger = LoggerFactory.getLogger(MqttCommandPublisherService.class);

    private final ObjectMapper objectMapper;
    private final String brokerUrl;
    private final String clientId;
    private final String username;
    private final String password;
    private final FirmwarePersistenceRepository firmwarePersistenceRepository;

    private final AtomicBoolean running = new AtomicBoolean(false);
    private final ScheduledExecutorService reconnectExecutor = Executors.newSingleThreadScheduledExecutor();
    private final AtomicLong requestSequence = new AtomicLong(0L);

    private MqttClient mqttClient;

    @Autowired
    public MqttCommandPublisherService(
            ObjectMapper objectMapper,
            FirmwarePersistenceRepository firmwarePersistenceRepository,
            @Value("${resq.mqtt.broker-url:tcp://localhost:1883}") String brokerUrl,
            @Value("${resq.mqtt.command-client-id:hub-api-session-commands}") String clientId,
            @Value("${resq.mqtt.username:}") String username,
            @Value("${resq.mqtt.password:}") String password
    ) {
        this.objectMapper = objectMapper;
        this.firmwarePersistenceRepository = firmwarePersistenceRepository;
        this.brokerUrl = brokerUrl;
        this.clientId = clientId;
        this.username = normalize(username);
        this.password = password;
    }

    public MqttCommandPublisherService(
            ObjectMapper objectMapper,
            FirmwarePersistenceRepository firmwarePersistenceRepository,
            String brokerUrl,
            String clientId
    ) {
        this(objectMapper, firmwarePersistenceRepository, brokerUrl, clientId, null, null);
    }

    public MqttCommandPublisherService(ObjectMapper objectMapper, String brokerUrl, String clientId) {
        this(
                objectMapper,
                defaultFirmwarePersistenceRepository(),
                brokerUrl,
                clientId,
                null,
                null
        );
        this.firmwarePersistenceRepository.initialize();
    }

    @PostConstruct
    public void start() {
        running.set(true);
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
            logger.info("MQTT command publisher disconnected");
        } catch (MqttException error) {
            logger.warn("Error while closing MQTT command publisher", error);
        }
    }

    public FirmwareCommandPublishResult publishDebugCommand(String deviceId) {
        return publishFirmwareCommand(
                FirmwareTopics.debugCommandTopic(deviceId),
                requestPayload(FirmwareCommandTypeId.DEBUG, null),
                "debug",
                FirmwareCommandTypeId.DEBUG
        );
    }

    public FirmwareCommandPublishResult publishCalibrationStartCommand(
            String deviceId,
            Integer hallDelta,
            Integer refPressure,
            Integer bladder1Pressure,
            Integer bladder2Pressure
    ) {
        return publishCalibrationStartCommand(deviceId, hallDelta, refPressure, bladder1Pressure, bladder2Pressure, null);
    }

    public FirmwareCommandPublishResult publishCalibrationStartCommand(
            String deviceId,
            Integer hallDelta,
            Integer refPressure,
            Integer bladder1Pressure,
            Integer bladder2Pressure,
            String profileId
    ) {
        Map<String, Object> payload = requestPayload(FirmwareCommandTypeId.CALIBRATION_START, null);
        payload.put("hall_delta", hallDelta);
        payload.put("ref_pressure", refPressure);
        payload.put("bladder_1_pressure", bladder1Pressure);
        payload.put("bladder_2_pressure", bladder2Pressure);
        if (profileId != null && !profileId.isBlank()) {
            payload.put("profile_id", profileId.trim());
        }
        return publishFirmwareCommand(
                FirmwareTopics.calibrationStartCommandTopic(deviceId),
                payload,
                "calibration start",
                FirmwareCommandTypeId.CALIBRATION_START
        );
    }

    public FirmwareCommandPublishResult publishCalibrationCancelCommand(String deviceId) {
        return publishFirmwareCommand(
                FirmwareTopics.calibrationCancelCommandTopic(deviceId),
                requestPayload(FirmwareCommandTypeId.CALIBRATION_CANCEL, null),
                "calibration cancel",
                FirmwareCommandTypeId.CALIBRATION_CANCEL
        );
    }

    public FirmwareCommandPublishResult publishCalibrationStart(
            String deviceId,
            String requestId,
            CalibrationStartRequest request
    ) {
        java.util.Map<String, Object> payload = new java.util.LinkedHashMap<>();
        payload.put("request_id", requestId);
        payload.put("issued_at_ms", Instant.now().toEpochMilli());
        payload.put("hall_delta", request.hallDelta());
        payload.put("ref_pressure", request.refPressure());
        payload.put("bladder_1_pressure", request.bladder1Pressure());
        payload.put("bladder_2_pressure", request.bladder2Pressure());
        if (request.profileId() != null && !request.profileId().isBlank()) {
            payload.put("profile_id", request.profileId().trim());
        }
        if (request.sampleIntervalMs() != null) {
            payload.put("sample_interval_ms", request.sampleIntervalMs());
        }
        if (request.calibrationWindowMs() != null) {
            payload.put("calibration_window_ms", request.calibrationWindowMs());
        }
        if (request.fullDepthMm() != null && request.fullDepthMm() > 0.0) {
            payload.put("full_depth_mm", request.fullDepthMm());
        }
        if (request.pressure0KpaPerCount() != null && request.pressure0KpaPerCount() > 0.0) {
            payload.put("pressure_0_kpa_per_count", request.pressure0KpaPerCount());
        }
        if (request.pressure1KpaPerCount() != null && request.pressure1KpaPerCount() > 0.0) {
            payload.put("pressure_1_kpa_per_count", request.pressure1KpaPerCount());
        }
        if (request.pressure2KpaPerCount() != null && request.pressure2KpaPerCount() > 0.0) {
            payload.put("pressure_2_kpa_per_count", request.pressure2KpaPerCount());
        }

        return publishFirmwareCommand(
                FirmwareTopics.calibrationStartCommandTopic(deviceId),
                payload,
                "calibration start",
                FirmwareCommandTypeId.CALIBRATION_START
        );
    }

    public FirmwareCommandPublishResult publishCalibrationCancel(String deviceId, String requestId) {
        java.util.Map<String, Object> payload = new java.util.LinkedHashMap<>();
        payload.put("request_id", requestId);
        payload.put("issued_at_ms", Instant.now().toEpochMilli());

        return publishFirmwareCommand(
                FirmwareTopics.calibrationCancelCommandTopic(deviceId),
                payload,
                "calibration cancel",
                FirmwareCommandTypeId.CALIBRATION_CANCEL
        );
    }

    public FirmwareCommandPublishResult publishSessionStartCommand(
            String deviceId,
            String sessionId,
            String profileId,
            Instant startedAt
    ) {
        Map<String, Object> payload = requestPayload(FirmwareCommandTypeId.SESSION_START, startedAt);
        payload.put("session_id", sessionId);
        payload.put("profile_id", profileId);
        return publishFirmwareCommand(
                FirmwareTopics.sessionStartCommandTopic(deviceId),
                payload,
                "session start",
                FirmwareCommandTypeId.SESSION_START
        );
    }

    public FirmwareCommandPublishResult publishSessionStopCommand(String deviceId, String sessionId, Instant endedAt) {
        Map<String, Object> payload = requestPayload(FirmwareCommandTypeId.SESSION_STOP, endedAt);
        payload.put("session_id", sessionId);
        return publishFirmwareCommand(
                FirmwareTopics.sessionStopCommandTopic(deviceId),
                payload,
                "session stop",
                FirmwareCommandTypeId.SESSION_STOP
        );
    }

    public FirmwareCommandPublishResult publishTelemetryControl(String deviceId, String action, Integer intervalMs) {
        String normalizedAction = normalize(action);
        if (normalizedAction == null) {
            throw new IllegalArgumentException("action must not be blank");
        }

        normalizedAction = normalizedAction.toUpperCase(Locale.ROOT);
        if (!"START".equals(normalizedAction) && !"STOP".equals(normalizedAction)) {
            throw new IllegalArgumentException("action must be START or STOP");
        }

        Map<String, Object> payload = requestPayload(FirmwareCommandTypeId.TELEMETRY_CONTROL, null);
        payload.put("action", normalizedAction);
        if ("START".equals(normalizedAction) && intervalMs != null) {
            payload.put("interval_ms", Math.max(50, Math.min(1000, intervalMs)));
        }

        return publishFirmwareCommand(
                FirmwareTopics.telemetryCommandTopic(deviceId),
                payload,
                "telemetry control",
                FirmwareCommandTypeId.TELEMETRY_CONTROL
        );
    }

    public FirmwareCommandPublishResult publishSystemRetryCommand(String deviceId) {
        return publishFirmwareCommand(
                FirmwareTopics.systemRetryCommandTopic(deviceId),
                requestPayload(FirmwareCommandTypeId.SYSTEM_RETRY, null),
                "system retry",
                FirmwareCommandTypeId.SYSTEM_RETRY
        );
    }

    public FirmwareCommandPublishResult publishSystemResetCommand(String deviceId) {
        return publishFirmwareCommand(
                FirmwareTopics.systemResetCommandTopic(deviceId),
                requestPayload(FirmwareCommandTypeId.SYSTEM_RESET, null),
                "system reset",
                FirmwareCommandTypeId.SYSTEM_RESET
        );
    }

    public FirmwareCommandPublishResult publishSystemFlushConfigCommand(String deviceId) {
        return publishFirmwareCommand(
                FirmwareTopics.systemFlushConfigCommandTopic(deviceId),
                requestPayload(FirmwareCommandTypeId.SYSTEM_FLUSH_CONFIG, null),
                "system flush-config",
                FirmwareCommandTypeId.SYSTEM_FLUSH_CONFIG
        );
    }

    public void publishSessionStart(SessionStartCommandPayload payload) {
        publishSessionStartCommand(
                payload.deviceId(),
                payload.sessionId(),
                payload.scenario(),
                payload.startedAt()
        );
    }

    public void publishSessionStop(SessionStopCommandPayload payload) {
        publishSessionStopCommand(payload.deviceId(), payload.sessionId(), payload.endedAt());
    }

    protected void ensureConnected() {
        if (!running.get()) {
            return;
        }

        try {
            if (mqttClient != null && mqttClient.isConnected()) {
                return;
            }

            connect();
        } catch (Exception error) {
            logger.warn("MQTT command publisher connect attempt failed. Will retry in 5s.", error);
        }
    }

    private synchronized void connect() throws MqttException {
        if (mqttClient != null && mqttClient.isConnected()) {
            return;
        }

        String resolvedClientId = clientId + "-" + System.currentTimeMillis();

        if (mqttClient != null) {
            try {
                mqttClient.close();
            } catch (MqttException error) {
                logger.debug("Failed to close previous MQTT command client before reconnect", error);
            }
        }

        mqttClient = new MqttClient(brokerUrl, resolvedClientId, new MemoryPersistence());

        MqttConnectOptions options = new MqttConnectOptions();
        options.setCleanSession(true);
        options.setAutomaticReconnect(true);
        options.setConnectionTimeout(5);
        applyCredentials(options);

        mqttClient.connect(options);
        logger.info("MQTT command publisher connected to {}", brokerUrl);
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

    protected FirmwareCommandPublishResult publishFirmwareCommand(
            String topic,
            Map<String, Object> payload,
            String action,
            FirmwareCommandTypeId commandTypeId
    ) {
        Instant now = Instant.now();
        String requestId = stringValue(payload.get("request_id"));
        FirmwareCommandRequestRecord pendingRecord = new FirmwareCommandRequestRecord(
                requestId,
                inferDeviceId(topic),
                commandTypeId.value(),
                commandTypeId.name(),
                topic,
                objectMapperValueAsString(payload),
                "PENDING",
                null,
                null,
                null,
                null,
                null,
                null,
                now,
                null,
                null,
                now.plusSeconds(120),
                now
        );

        try {
            firmwarePersistenceRepository.recordCommandRequest(pendingRecord);
            ensureConnected();

            Map<String, Object> normalizedPayload = new LinkedHashMap<>(payload);
            String json = objectMapper.writeValueAsString(normalizedPayload);
            publishToBroker(topic, json);

            firmwarePersistenceRepository.markCommandPublished(requestId, Instant.now());
            logger.info(
                    "Published MQTT {} command to {} for request {}",
                    action,
                    topic,
                    requestId
            );
            return new FirmwareCommandPublishResult(topic, requestId, normalizedPayload);
        } catch (Exception error) {
            if (requestId != null) {
                try {
                    firmwarePersistenceRepository.markCommandFailed(requestId, Instant.now(), error.getMessage());
                } catch (Exception persistenceError) {
                    logger.warn("Failed to mark firmware command {} as FAILED after publish error", requestId, persistenceError);
                }
            }
            logger.warn("Failed to publish MQTT {} command to {}. Error message: {}", action, topic, error.getMessage(), error);
            throw new MqttCommandPublishException("Failed to publish MQTT " + action + " command to " + topic, error);
        }
    }

    protected void publishToBroker(String topic, String jsonPayload) throws Exception {
        ensureConnected();
        if (mqttClient == null || !mqttClient.isConnected()) {
            throw new IllegalStateException("MQTT command publisher is not connected");
        }

        MqttMessage message = new MqttMessage(jsonPayload.getBytes(StandardCharsets.UTF_8));
        message.setQos(0);
        mqttClient.publish(topic, message);
    }

    private Map<String, Object> requestPayload(FirmwareCommandTypeId commandTypeId, Instant timestamp) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("request_id", FirmwareRequestIds.format(commandTypeId.value(), Math.toIntExact(requestSequence.incrementAndGet())));
        payload.put("issued_at_ms", (timestamp == null ? Instant.now() : timestamp).toEpochMilli());
        return payload;
    }

    private static String stringValue(Object value) {
        return value == null ? null : value.toString();
    }

    private static FirmwarePersistenceRepository defaultFirmwarePersistenceRepository() {
        return new FirmwarePersistenceRepository(Path.of(System.getProperty("user.home"), ".resq-localhub", "hub-api.sqlite").toString());
    }

    private String objectMapperValueAsString(Map<String, Object> payload) {
        try {
            return objectMapper.writeValueAsString(payload);
        } catch (Exception error) {
            throw new IllegalStateException("Failed to serialize firmware command payload", error);
        }
    }

    private static String inferDeviceId(String topic) {
        if (topic == null || topic.isBlank()) {
            return null;
        }

        String[] parts = topic.split("/");
        if (parts.length >= 4 && "manikins".equals(parts[1])) {
            return parts[2];
        }
        if (parts.length >= 3 && "resq".equals(parts[0])) {
            return parts[1];
        }
        return null;
    }

    private static String normalize(String value) {
        if (value == null) {
            return null;
        }

        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    public record FirmwareCommandPublishResult(String topic, String requestId, Map<String, Object> payload) {
        public FirmwareCommandPublishResult {
            payload = Collections.unmodifiableMap(new LinkedHashMap<>(payload));
        }
    }
}
