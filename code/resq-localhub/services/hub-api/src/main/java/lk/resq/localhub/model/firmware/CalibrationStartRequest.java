package lk.resq.localhub.model.firmware;

import com.fasterxml.jackson.annotation.JsonProperty;

public record CalibrationStartRequest(
        @JsonProperty("hall_delta") Integer hallDelta,
        @JsonProperty("ref_pressure") Integer refPressure,
        @JsonProperty("bladder_1_pressure") Integer bladder1Pressure,
        @JsonProperty("bladder_2_pressure") Integer bladder2Pressure,
        @JsonProperty("profile_id") String profileId,
        @JsonProperty("sample_interval_ms") Integer sampleIntervalMs,
        @JsonProperty("calibration_window_ms") Integer calibrationWindowMs
) {
}
