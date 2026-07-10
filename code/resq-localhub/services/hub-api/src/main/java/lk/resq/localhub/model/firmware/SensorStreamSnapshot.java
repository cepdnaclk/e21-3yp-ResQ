package lk.resq.localhub.model.firmware;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;

public record SensorStreamSnapshot(
        @JsonProperty("device_id") String deviceId,
        @JsonProperty("telemetry_mode") String telemetryMode,
        String state,
        @JsonProperty("pressure_0_kpa") Double pressure0Kpa,
        @JsonProperty("pressure_0_kpa_valid") Boolean pressure0KpaValid,
        @JsonProperty("pressure_1_kpa") Double pressure1Kpa,
        @JsonProperty("pressure_1_kpa_valid") Boolean pressure1KpaValid,
        @JsonProperty("pressure_2_kpa") Double pressure2Kpa,
        @JsonProperty("pressure_2_kpa_valid") Boolean pressure2KpaValid,
        @JsonProperty("pressure_kpa_valid") Boolean pressureKpaValid,
        @JsonProperty("hall_mm") Double hallMm,
        @JsonProperty("hall_progress") Double hallProgress,
        @JsonProperty("hall_mm_valid") Boolean hallMmValid,
        @JsonProperty("pressure_saturation_mask") Integer pressureSaturationMask,
        @JsonProperty("interval_ms") Integer intervalMs,
        @JsonProperty("ts_ms") Long tsMs,
        Instant receivedAt
) {
}
