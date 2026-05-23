package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.localhub.model.SessionStartCommandPayload;
import lk.resq.localhub.model.SessionStopCommandPayload;
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
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

@Service
public class MqttCommandPublisherService {

    private static final Logger logger = LoggerFactory.getLogger(MqttCommandPublisherService.class);

    private final ObjectMapper objectMapper;
    private final String brokerUrl;
    private final String clientId;
    private final String username;
    private final String password;

    private final AtomicBoolean running = new AtomicBoolean(false);
    private final ScheduledExecutorService reconnectExecutor = Executors.newSingleThreadScheduledExecutor();

    private MqttClient mqttClient;

        @Autowired
        public MqttCommandPublisherService(
            ObjectMapper objectMapper,
            @Value("${resq.mqtt.broker-url:tcp://localhost:1883}") String brokerUrl,
            @Value("${resq.mqtt.command-client-id:hub-api-session-commands}") String clientId,
            @Value("${resq.mqtt.username:}") String username,
            @Value("${resq.mqtt.password:}") String password
    ) {
        this.objectMapper = objectMapper;
        this.brokerUrl = brokerUrl;
        this.clientId = clientId;
        this.username = normalize(username);
        this.password = password;
    }

    public MqttCommandPublisherService(ObjectMapper objectMapper, String brokerUrl, String clientId) {
        this(objectMapper, brokerUrl, clientId, null, null);
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

    public void publishSessionStart(SessionStartCommandPayload payload) {
        publish("resq/manikins/%s/cmd/session/start".formatted(payload.deviceId()), payload, "start");
    }

    public void publishSessionStop(SessionStopCommandPayload payload) {
        publish("resq/manikins/%s/cmd/session/stop".formatted(payload.deviceId()), payload, "stop");
    }

    private void ensureConnected() {
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

    private void publish(String topic, Object payload, String action) {
        try {
            ensureConnected();
            if (mqttClient == null || !mqttClient.isConnected()) {
                throw new IllegalStateException("MQTT command publisher is not connected");
            }

            String json = objectMapper.writeValueAsString(payload);
            MqttMessage message = new MqttMessage(json.getBytes(StandardCharsets.UTF_8));
            message.setQos(0);
            mqttClient.publish(topic, message);

            if (payload instanceof SessionStartCommandPayload startPayload) {
                logger.info("Published MQTT start command to {} for session {}", topic, startPayload.sessionId());
            } else if (payload instanceof SessionStopCommandPayload stopPayload) {
                logger.info("Published MQTT stop command to {} for session {}", topic, stopPayload.sessionId());
            } else {
                logger.info("Published MQTT {} command to {}", action, topic);
            }
        } catch (Exception error) {
            logger.warn("Failed to publish MQTT {} command to {}. Error message: {}", action, topic, error.getMessage(), error);
            throw new MqttCommandPublishException("Failed to publish MQTT " + action + " command to " + topic, error);
        }
    }

    private static String normalize(String value) {
        if (value == null) {
            return null;
        }

        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
