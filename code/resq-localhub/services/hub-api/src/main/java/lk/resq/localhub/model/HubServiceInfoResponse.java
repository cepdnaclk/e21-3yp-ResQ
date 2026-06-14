package lk.resq.localhub.model;

import com.fasterxml.jackson.annotation.JsonProperty;

public record HubServiceInfoResponse(
        boolean ok,
        @JsonProperty("backend_base_url")
        String backendBaseUrl,
        @JsonProperty("mqtt_host")
        String mqttHost,
        @JsonProperty("mqtt_port")
        int mqttPort,
        @JsonProperty("dashboard_url")
        String dashboardUrl,
        @JsonProperty("local_ip")
        String localIp,
        @JsonProperty("cloud_sync_enabled")
        boolean cloudSyncEnabled,
        @JsonProperty("roster_sync_enabled")
        boolean rosterSyncEnabled
) {
}
