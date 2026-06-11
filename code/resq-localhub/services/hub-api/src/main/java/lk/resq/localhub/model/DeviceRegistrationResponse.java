package lk.resq.localhub.model;

import com.fasterxml.jackson.annotation.JsonProperty;

public record DeviceRegistrationResponse(
        boolean ok,
        @JsonProperty("device_id")
        String deviceId,
        @JsonProperty("mqtt_host")
        String mqttHost,
        @JsonProperty("mqtt_port")
        int mqttPort
) {
}
