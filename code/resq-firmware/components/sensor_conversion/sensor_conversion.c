#include "sensor_conversion.h"

#include <math.h>
#include <string.h>

float sensor_conversion_clamp_float(float value, float min_value, float max_value)
{
    if (value < min_value) {
        return min_value;
    }
    if (value > max_value) {
        return max_value;
    }
    return value;
}

bool sensor_conversion_pressure_raw_is_saturated(int32_t raw)
{
    return raw >= SENSOR_CONVERSION_PRESSURE_SATURATION_RAW ||
           raw <= -SENSOR_CONVERSION_PRESSURE_SATURATION_RAW;
}

esp_err_t sensor_conversion_pressure_to_kpa(int32_t raw,
                                            int32_t baseline_raw,
                                            float kpa_per_count,
                                            float *out_kpa)
{
    if (out_kpa == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    *out_kpa = 0.0f;
    if (kpa_per_count <= 0.0f ||
        baseline_raw == 0 ||
        sensor_conversion_pressure_raw_is_saturated(raw)) {
        return ESP_ERR_INVALID_STATE;
    }

    *out_kpa = fabsf((float)(raw - baseline_raw)) * kpa_per_count;
    return ESP_OK;
}

esp_err_t sensor_conversion_hall_to_mm(int32_t hall_raw,
                                       int32_t hall_baseline_raw,
                                       int32_t hall_range_raw,
                                       int32_t hall_direction,
                                       float full_depth_mm,
                                       float *out_hall_mm,
                                       float *out_progress,
                                       int32_t *out_delta_raw)
{
    if (out_hall_mm == NULL || out_progress == NULL || out_delta_raw == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    *out_hall_mm = 0.0f;
    *out_progress = 0.0f;
    *out_delta_raw = 0;

    if (hall_baseline_raw <= 0 ||
        hall_range_raw <= 0 ||
        full_depth_mm <= 0.0f ||
        !(hall_direction == 1 || hall_direction == -1)) {
        return ESP_ERR_INVALID_STATE;
    }

    *out_delta_raw = (hall_raw - hall_baseline_raw) * hall_direction;
    *out_progress = sensor_conversion_clamp_float((float)(*out_delta_raw) / (float)hall_range_raw,
                                                  0.0f,
                                                  1.0f);
    *out_hall_mm = *out_progress * full_depth_mm;
    return ESP_OK;
}

esp_err_t sensor_conversion_convert_sample(const sensor_raw_sample_t *raw,
                                           const calibration_config_t *calibration,
                                           sensor_converted_sample_t *out)
{
    if (raw == NULL || calibration == NULL || out == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    memset(out, 0, sizeof(*out));
    out->ts_ms = raw->ts_ms;

    if (sensor_conversion_pressure_raw_is_saturated(raw->pressure_0_raw)) {
        out->pressure_saturation_mask |= 0x01u;
    }
    if (sensor_conversion_pressure_raw_is_saturated(raw->pressure_1_raw)) {
        out->pressure_saturation_mask |= 0x02u;
    }
    if (sensor_conversion_pressure_raw_is_saturated(raw->pressure_2_raw)) {
        out->pressure_saturation_mask |= 0x04u;
    }
    out->pressure_saturated = out->pressure_saturation_mask != 0;

    out->pressure_0_kpa_valid =
        sensor_conversion_pressure_to_kpa(raw->pressure_0_raw,
                                          calibration->pressure_0_baseline,
                                          calibration->pressure_0_kpa_per_count,
                                          &out->pressure_0_kpa) == ESP_OK;
    out->pressure_1_kpa_valid =
        sensor_conversion_pressure_to_kpa(raw->pressure_1_raw,
                                          calibration->pressure_1_baseline,
                                          calibration->pressure_1_kpa_per_count,
                                          &out->pressure_1_kpa) == ESP_OK;
    out->pressure_2_kpa_valid =
        sensor_conversion_pressure_to_kpa(raw->pressure_2_raw,
                                          calibration->pressure_2_baseline,
                                          calibration->pressure_2_kpa_per_count,
                                          &out->pressure_2_kpa) == ESP_OK;
    out->pressure_kpa_valid =
        out->pressure_0_kpa_valid &&
        out->pressure_1_kpa_valid &&
        out->pressure_2_kpa_valid;

    out->hall_mm_valid =
        sensor_conversion_hall_to_mm(raw->hall_raw,
                                     calibration->hall_baseline,
                                     calibration->hall_range_raw,
                                     calibration->hall_direction,
                                     calibration->full_depth_mm,
                                     &out->hall_mm,
                                     &out->hall_progress,
                                     &out->hall_delta_raw) == ESP_OK;

    return ESP_OK;
}
