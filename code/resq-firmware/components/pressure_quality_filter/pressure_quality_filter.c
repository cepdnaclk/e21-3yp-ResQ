#include "pressure_quality_filter.h"

#include <limits.h>
#include <string.h>

static bool pressure_quality_config_valid(
    const pressure_quality_config_t *config)
{
    if (config == NULL ||
        config->window_size < 2 ||
        config->window_size > PRESSURE_FILTER_MAX_WINDOW ||
        config->required_channel_mask == 0 ||
        (config->required_channel_mask & ~PRESSURE_CHANNEL_MASK_ALL) != 0) {
        return false;
    }

    for (size_t channel = 0; channel < PRESSURE_CHANNEL_COUNT; ++channel) {
        if (config->min_raw[channel] > config->max_raw[channel] ||
            config->max_spread_raw[channel] < 0) {
            return false;
        }
    }
    return true;
}

esp_err_t pressure_quality_filter_init(
    pressure_quality_filter_t *filter,
    const pressure_quality_config_t *config)
{
    if (filter == NULL || !pressure_quality_config_valid(config)) {
        return ESP_ERR_INVALID_ARG;
    }

    memset(filter, 0, sizeof(*filter));
    memcpy(&filter->config, config, sizeof(*config));
    return ESP_OK;
}

void pressure_quality_filter_reset(pressure_quality_filter_t *filter)
{
    if (filter == NULL) {
        return;
    }

    pressure_quality_config_t config = filter->config;
    memset(filter, 0, sizeof(*filter));
    filter->config = config;
}

static bool channel_window_stable(
    const pressure_quality_filter_t *filter,
    size_t channel,
    int32_t *out_mean)
{
    size_t count = filter->window_count[channel];
    if (count < filter->config.window_size) {
        return false;
    }

    int32_t minimum = INT32_MAX;
    int32_t maximum = INT32_MIN;
    int64_t sum = 0;
    for (size_t i = 0; i < count; ++i) {
        int32_t value = filter->window[channel][i];
        if (value < minimum) {
            minimum = value;
        }
        if (value > maximum) {
            maximum = value;
        }
        sum += value;
    }

    int64_t spread = (int64_t)maximum - (int64_t)minimum;
    if (spread > filter->config.max_spread_raw[channel]) {
        return false;
    }

    if (out_mean != NULL) {
        *out_mean = (int32_t)(sum / (int64_t)count);
    }
    return true;
}

static void copy_last_accepted(
    const pressure_quality_filter_t *filter,
    pressure_quality_result_t *result)
{
    result->has_last_accepted = filter->has_last_accepted;
    result->using_last_accepted = filter->has_last_accepted;
    result->accepted_timestamp_ms = filter->last_accepted_timestamp_ms;
    if (filter->has_last_accepted) {
        memcpy(result->accepted_raw, filter->last_accepted_raw,
               sizeof(result->accepted_raw));
    }
}

esp_err_t pressure_quality_filter_push(
    pressure_quality_filter_t *filter,
    const pressure_raw_frame_t *frame,
    pressure_quality_result_t *result)
{
    if (filter == NULL || frame == NULL || result == NULL ||
        !pressure_quality_config_valid(&filter->config)) {
        return ESP_ERR_INVALID_ARG;
    }

    memset(result, 0, sizeof(*result));
    result->group_read_valid =
        (frame->read_valid_mask & PRESSURE_CHANNEL_MASK_ALL) ==
        PRESSURE_CHANNEL_MASK_ALL;
    result->channel_valid_mask =
        frame->read_valid_mask & PRESSURE_CHANNEL_MASK_ALL;
    result->saturation_mask =
        frame->saturation_mask & PRESSURE_CHANNEL_MASK_ALL;

    int32_t stable_mean[PRESSURE_CHANNEL_COUNT] = {0};
    for (size_t channel = 0; channel < PRESSURE_CHANNEL_COUNT; ++channel) {
        uint8_t bit = (uint8_t)(1u << channel);
        bool read_valid = (result->channel_valid_mask & bit) != 0;
        bool saturated = (result->saturation_mask & bit) != 0;
        bool within_range =
            read_valid &&
            frame->raw[channel] >= filter->config.min_raw[channel] &&
            frame->raw[channel] <= filter->config.max_raw[channel];

        if (within_range) {
            result->within_range_mask |= bit;
        }

        if (read_valid && within_range && !saturated) {
            size_t index = filter->write_index[channel];
            filter->window[channel][index] = frame->raw[channel];
            filter->write_index[channel] =
                (index + 1u) % filter->config.window_size;
            if (filter->window_count[channel] < filter->config.window_size) {
                filter->window_count[channel]++;
            }
        }

        if (channel_window_stable(filter, channel, &stable_mean[channel])) {
            result->stable_mask |= bit;
        }
    }

    result->stable_window_ready =
        (result->stable_mask & filter->config.required_channel_mask) ==
        filter->config.required_channel_mask;
    result->decision_usable_mask =
        result->channel_valid_mask &
        result->within_range_mask &
        (uint8_t)~result->saturation_mask &
        result->stable_mask &
        PRESSURE_CHANNEL_MASK_ALL;
    result->all_required_channels_usable =
        (result->decision_usable_mask &
         filter->config.required_channel_mask) ==
        filter->config.required_channel_mask;

    if (result->all_required_channels_usable) {
        for (size_t channel = 0; channel < PRESSURE_CHANNEL_COUNT; ++channel) {
            uint8_t bit = (uint8_t)(1u << channel);
            if ((result->decision_usable_mask & bit) != 0) {
                filter->last_accepted_raw[channel] = stable_mean[channel];
            }
        }
        filter->last_accepted_timestamp_ms = frame->timestamp_ms;
        filter->has_last_accepted = true;
        filter->accepted_sample_count++;
        filter->consecutive_invalid_count = 0;
    } else {
        filter->consecutive_invalid_count++;
    }

    copy_last_accepted(filter, result);
    result->using_last_accepted =
        filter->has_last_accepted && !result->all_required_channels_usable;
    result->accepted_sample_count = filter->accepted_sample_count;
    result->consecutive_invalid_count = filter->consecutive_invalid_count;
    return ESP_OK;
}

bool pressure_quality_filter_get_last_accepted(
    const pressure_quality_filter_t *filter,
    int32_t out_raw[PRESSURE_CHANNEL_COUNT],
    int64_t *out_timestamp_ms)
{
    if (filter == NULL || out_raw == NULL || !filter->has_last_accepted) {
        return false;
    }

    memcpy(out_raw, filter->last_accepted_raw,
           sizeof(filter->last_accepted_raw));
    if (out_timestamp_ms != NULL) {
        *out_timestamp_ms = filter->last_accepted_timestamp_ms;
    }
    return true;
}
