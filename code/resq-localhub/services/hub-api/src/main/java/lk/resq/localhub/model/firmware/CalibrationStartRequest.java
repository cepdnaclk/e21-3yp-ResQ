package lk.resq.localhub.model.firmware;

import com.fasterxml.jackson.annotation.JsonProperty;

public record CalibrationStartRequest(
        @JsonProperty("hall_delta") Integer hallDelta,
        @JsonProperty("ref_pressure") Integer refPressure,
        @JsonProperty("bladder_1_pressure") Integer bladder1Pressure,
        @JsonProperty("bladder_2_pressure") Integer bladder2Pressure,
        @JsonProperty("profile_id") String profileId,
        @JsonProperty("sample_interval_ms") Integer sampleIntervalMs,
        @JsonProperty("calibration_window_ms") Integer calibrationWindowMs,
        @JsonProperty("full_depth_mm") Double fullDepthMm,
        @JsonProperty("pressure_0_kpa_per_count") Double pressure0KpaPerCount,
        @JsonProperty("pressure_1_kpa_per_count") Double pressure1KpaPerCount,
        @JsonProperty("pressure_2_kpa_per_count") Double pressure2KpaPerCount
) {
    public CalibrationStartRequest(
            Integer hallDelta,
            Integer refPressure,
            Integer bladder1Pressure,
            Integer bladder2Pressure,
            String profileId,
            Integer sampleIntervalMs,
            Integer calibrationWindowMs
    ) {
        this(
                hallDelta,
                refPressure,
                bladder1Pressure,
                bladder2Pressure,
                profileId,
                sampleIntervalMs,
                calibrationWindowMs,
                null,
                null,
                null,
                null
        );
    }
}
