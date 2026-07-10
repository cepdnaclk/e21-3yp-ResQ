#ifndef SENSOR_CONVERSION_H
#define SENSOR_CONVERSION_H

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Pure sensor conversion helpers for ResQ pressure and Hall samples.
 *
 * Formulas:
 * - pressure_kpa = abs(pressure_raw - pressure_baseline_raw) * pressure_kpa_per_count
 * - hall_delta_raw = (hall_raw - hall_baseline_raw) * hall_direction
 * - hall_progress = clamp(hall_delta_raw / hall_range_raw, 0.0, 1.0)
 * - hall_mm = hall_progress * full_depth_mm
 *
 * The module owns conversion and validity only. It does not read hardware, use
 * NVS, publish MQTT, allocate memory, create RTOS objects, or inspect runtime
 * state. Invalid numeric outputs are initialized to 0.0f/0 and flagged invalid.
 *
 * required_pressure_mask selects which pressure channels are needed for the
 * aggregate pressure_kpa_valid flag. A zero mask defaults to all three channels.
 * Bits outside SENSOR_CONVERSION_PRESSURE_SUPPORTED_MASK are ignored.
 *
 * pressure_saturation_mask is copied from the raw sample. A set bit invalidates
 * only that pressure channel; other channels can still be converted.
 */

#define SENSOR_CONVERSION_PRESSURE_CHANNEL_COUNT 3U
#define SENSOR_CONVERSION_PRESSURE_SUPPORTED_MASK 0x07u
#define SENSOR_CONVERSION_PRESSURE_DEFAULT_REQUIRED_MASK \
    SENSOR_CONVERSION_PRESSURE_SUPPORTED_MASK
#define SENSOR_CONVERSION_PRESSURE_SATURATION_RAW 8300000

typedef struct {
    int32_t pressure_raw[SENSOR_CONVERSION_PRESSURE_CHANNEL_COUNT];
    bool pressure_read_valid[SENSOR_CONVERSION_PRESSURE_CHANNEL_COUNT];

    int32_t hall_raw;
    bool hall_read_valid;

    uint32_t pressure_saturation_mask;
    int64_t timestamp_ms;
} sensor_raw_sample_t;

typedef struct {
    int32_t pressure_baseline_raw[SENSOR_CONVERSION_PRESSURE_CHANNEL_COUNT];
    bool pressure_baseline_valid[SENSOR_CONVERSION_PRESSURE_CHANNEL_COUNT];

    float pressure_kpa_per_count[SENSOR_CONVERSION_PRESSURE_CHANNEL_COUNT];

    int32_t hall_baseline_raw;
    bool hall_baseline_valid;

    int32_t hall_range_raw;
    int8_t hall_direction;

    float full_depth_mm;

    uint32_t required_pressure_mask;
} sensor_conversion_profile_t;

typedef struct {
    float pressure_kpa[SENSOR_CONVERSION_PRESSURE_CHANNEL_COUNT];
    bool pressure_kpa_channel_valid[SENSOR_CONVERSION_PRESSURE_CHANNEL_COUNT];

    uint32_t pressure_valid_mask;
    uint32_t pressure_saturation_mask;

    bool pressure_profile_valid;
    bool pressure_kpa_valid;
    bool sample_pressure_kpa_valid;

    int32_t hall_delta_raw;
    float hall_progress;
    float hall_mm;

    bool hall_profile_valid;
    bool hall_mm_valid;
    bool sample_hall_mm_valid;

    int64_t timestamp_ms;
} sensor_converted_sample_t;

uint32_t sensor_conversion_normalize_pressure_mask(uint32_t required_pressure_mask);

bool sensor_conversion_pressure_raw_is_saturated(int32_t raw);

esp_err_t sensor_conversion_convert(const sensor_raw_sample_t *raw,
                                    const sensor_conversion_profile_t *profile,
                                    sensor_converted_sample_t *out);

#ifdef __cplusplus
}
#endif

#endif
