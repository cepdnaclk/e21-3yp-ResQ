#ifndef SENSOR_CONVERSION_H
#define SENSOR_CONVERSION_H

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"
#include "resq_config_types.h"

#ifdef __cplusplus
extern "C" {
#endif

#define SENSOR_CONVERSION_PRESSURE_SATURATION_RAW 8300000

typedef struct {
    int32_t pressure_0_raw;
    int32_t pressure_1_raw;
    int32_t pressure_2_raw;
    int32_t hall_raw;
    int64_t ts_ms;
    uint32_t quality_flags;
} sensor_raw_sample_t;

typedef struct {
    float pressure_0_kpa;
    float pressure_1_kpa;
    float pressure_2_kpa;

    bool pressure_0_kpa_valid;
    bool pressure_1_kpa_valid;
    bool pressure_2_kpa_valid;
    bool pressure_kpa_valid;

    float hall_mm;
    float hall_progress;
    int32_t hall_delta_raw;
    bool hall_mm_valid;

    bool pressure_saturated;
    uint8_t pressure_saturation_mask;

    int64_t ts_ms;
} sensor_converted_sample_t;

float sensor_conversion_clamp_float(float value, float min_value, float max_value);

bool sensor_conversion_pressure_raw_is_saturated(int32_t raw);

esp_err_t sensor_conversion_pressure_to_kpa(int32_t raw,
                                            int32_t baseline_raw,
                                            float kpa_per_count,
                                            float *out_kpa);

esp_err_t sensor_conversion_hall_to_mm(int32_t hall_raw,
                                       int32_t hall_baseline_raw,
                                       int32_t hall_range_raw,
                                       int32_t hall_direction,
                                       float full_depth_mm,
                                       float *out_hall_mm,
                                       float *out_progress,
                                       int32_t *out_delta_raw);

esp_err_t sensor_conversion_convert_sample(const sensor_raw_sample_t *raw,
                                           const calibration_config_t *calibration,
                                           sensor_converted_sample_t *out);

#ifdef __cplusplus
}
#endif

#endif
