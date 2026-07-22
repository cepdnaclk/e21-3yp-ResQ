package lk.resq.localhub.model;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonProperty;

public record DeviceRegistrationRequest(
        @JsonAlias("device_mac")
        String mac,
        @JsonProperty("chip_id")
        String chipId,
        @JsonProperty("firmware_version")
        String firmwareVersion,
        @JsonProperty("device_label")
        String deviceLabel
) {
}
