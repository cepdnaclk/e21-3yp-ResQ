package lk.resq.localhub.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class MqttQosPolicy {
    private final int commandQos;
    private final int statusQos;
    private final int eventQos;
    private final int telemetryQos;
    private final int heartbeatQos;
    private final int debugQos;

    public MqttQosPolicy(
            @Value("${resq.mqtt.command-qos:1}") int commandQos,
            @Value("${resq.mqtt.status-qos:1}") int statusQos,
            @Value("${resq.mqtt.event-qos:1}") int eventQos,
            @Value("${resq.mqtt.telemetry-qos:0}") int telemetryQos,
            @Value("${resq.mqtt.heartbeat-qos:0}") int heartbeatQos,
            @Value("${resq.mqtt.debug-qos:0}") int debugQos
    ) {
        this.commandQos = validate("resq.mqtt.command-qos", commandQos);
        this.statusQos = validate("resq.mqtt.status-qos", statusQos);
        this.eventQos = validate("resq.mqtt.event-qos", eventQos);
        this.telemetryQos = validate("resq.mqtt.telemetry-qos", telemetryQos);
        this.heartbeatQos = validate("resq.mqtt.heartbeat-qos", heartbeatQos);
        this.debugQos = validate("resq.mqtt.debug-qos", debugQos);
    }

    public static MqttQosPolicy defaults() {
        return new MqttQosPolicy(1, 1, 1, 0, 0, 0);
    }

    public int commandQos() {
        return commandQos;
    }

    public int qosForMessageType(String messageType) {
        return switch (messageType) {
            case "status" -> statusQos;
            case "events", "events/calibration", "events/error" -> eventQos;
            case "telemetry" -> telemetryQos;
            case "heartbeat" -> heartbeatQos;
            case "debug" -> debugQos;
            default -> eventQos;
        };
    }

    private static int validate(String property, int value) {
        if (value < 0 || value > 2) {
            throw new IllegalArgumentException(property + " must be 0, 1, or 2");
        }
        return value;
    }
}
