#ifndef PRESSURE_QUALITY_FILTER_H
#define PRESSURE_QUALITY_FILTER_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

#define PRESSURE_CHANNEL_COUNT 3u
#define PRESSURE_CHANNEL_MASK_ALL 0x07u
#define PRESSURE_FILTER_MAX_WINDOW 16u

typedef struct {
    int32_t raw[PRESSURE_CHANNEL_COUNT];
    uint8_t read_valid_mask;
    uint8_t saturation_mask;
    int64_t timestamp_ms;
} pressure_raw_frame_t;

typedef struct {
    size_t window_size;
    uint8_t required_channel_mask;
    int32_t min_raw[PRESSURE_CHANNEL_COUNT];
    int32_t max_raw[PRESSURE_CHANNEL_COUNT];
    int32_t max_spread_raw[PRESSURE_CHANNEL_COUNT];
} pressure_quality_config_t;

typedef struct {
    bool group_read_valid;
    uint8_t channel_valid_mask;
    uint8_t within_range_mask;
    uint8_t saturation_mask;
    uint8_t stable_mask;
    uint8_t decision_usable_mask;
    bool all_required_channels_usable;
    bool stable_window_ready;
    bool has_last_accepted;
    bool using_last_accepted;
    int32_t accepted_raw[PRESSURE_CHANNEL_COUNT];
    int64_t accepted_timestamp_ms;
    unsigned accepted_sample_count;
    unsigned consecutive_invalid_count;
} pressure_quality_result_t;

typedef struct {
    pressure_quality_config_t config;
    int32_t window[PRESSURE_CHANNEL_COUNT][PRESSURE_FILTER_MAX_WINDOW];
    size_t window_count[PRESSURE_CHANNEL_COUNT];
    size_t write_index[PRESSURE_CHANNEL_COUNT];
    int32_t last_accepted_raw[PRESSURE_CHANNEL_COUNT];
    int64_t last_accepted_timestamp_ms;
    bool has_last_accepted;
    unsigned accepted_sample_count;
    unsigned consecutive_invalid_count;
} pressure_quality_filter_t;

/**
 * Configure a rolling pressure-quality filter.
 *
 * max_spread_raw is expressed in HX710 raw ADC counts. A channel becomes
 * stable only after window_size accepted observations exist and their
 * peak-to-peak spread does not exceed the configured channel limit.
 */
esp_err_t pressure_quality_filter_init(
    pressure_quality_filter_t *filter,
    const pressure_quality_config_t *config);

/** Remove all rolling and last-accepted evidence. */
void pressure_quality_filter_reset(pressure_quality_filter_t *filter);

/**
 * Process one attempted synchronized HX710 frame.
 *
 * Invalid, saturated, and out-of-range channel values are never inserted into
 * the rolling windows and never overwrite the last accepted frame.
 */
esp_err_t pressure_quality_filter_push(
    pressure_quality_filter_t *filter,
    const pressure_raw_frame_t *frame,
    pressure_quality_result_t *result);

bool pressure_quality_filter_get_last_accepted(
    const pressure_quality_filter_t *filter,
    int32_t out_raw[PRESSURE_CHANNEL_COUNT],
    int64_t *out_timestamp_ms);

#ifdef __cplusplus
}
#endif

#endif
