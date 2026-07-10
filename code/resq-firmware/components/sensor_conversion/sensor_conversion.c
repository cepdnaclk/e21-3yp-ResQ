#include "sensor_conversion.h"

#include <float.h>
#include <limits.h>
#include <math.h>
#include <string.h>

static float clamp_float(float value, float min_value, float max_value)
{
    if (value < min_value) {
        return min_value;
    }
    if (value > max_value) {
        return max_value;
    }
    return value;
}

uint32_t sensor_conversion_normalize_pressure_mask(uint32_t required_pressure_mask)
{
    uint32_t mask = required_pressure_mask & SENSOR_CONVERSION_PRESSURE_SUPPORTED_MASK;
    if (mask == 0u) {
        mask = SENSOR_CONVERSION_PRESSURE_DEFAULT_REQUIRED_MASK;
    }
    return mask;
}

bool sensor_conversion_pressure_raw_is_saturated(int32_t raw)
{
    return raw >= SENSOR_CONVERSION_PRESSURE_SATURATION_RAW ||
           raw <= -SENSOR_CONVERSION_PRESSURE_SATURATION_RAW;
}

static bool pressure_channel_profile_valid(const sensor_conversion_profile_t *profile,
                                           size_t channel)
{
    float coefficient = profile->pressure_kpa_per_count[channel];
    return profile->pressure_baseline_valid[channel] &&
           isfinite(coefficient) &&
           coefficient > 0.0f;
}

static bool pressure_required_channels_valid(uint32_t valid_mask, uint32_t required_mask)
{
    return (valid_mask & required_mask) == required_mask;
}

static bool convert_pressure_channel(int32_t raw,
                                     int32_t baseline_raw,
                                     float kpa_per_count,
                                     float *out_kpa)
{
    *out_kpa = 0.0f;

    int64_t delta = (int64_t)raw - (int64_t)baseline_raw;
    uint64_t magnitude = delta < 0 ? (uint64_t)(-delta) : (uint64_t)delta;
    double kpa = (double)magnitude * (double)kpa_per_count;

    if (!isfinite(kpa) || kpa > (double)FLT_MAX) {
        return false;
    }

    *out_kpa = (float)kpa;
    return isfinite(*out_kpa);
}

static bool hall_profile_valid(const sensor_conversion_profile_t *profile)
{
    return profile->hall_baseline_valid &&
           profile->hall_range_raw > 0 &&
           (profile->hall_direction == 1 || profile->hall_direction == -1) &&
           isfinite(profile->full_depth_mm) &&
           profile->full_depth_mm > 0.0f;
}

static bool convert_hall(const sensor_raw_sample_t *raw,
                         const sensor_conversion_profile_t *profile,
                         sensor_converted_sample_t *out)
{
    if (!raw->hall_read_valid || !out->hall_profile_valid) {
        return false;
    }

    int64_t delta = ((int64_t)raw->hall_raw - (int64_t)profile->hall_baseline_raw) *
                    (int64_t)profile->hall_direction;
    if (delta < (int64_t)INT32_MIN || delta > (int64_t)INT32_MAX) {
        return false;
    }

    float progress = (float)((double)delta / (double)profile->hall_range_raw);
    if (!isfinite(progress)) {
        return false;
    }

    progress = clamp_float(progress, 0.0f, 1.0f);
    float hall_mm = progress * profile->full_depth_mm;
    if (!isfinite(hall_mm)) {
        return false;
    }

    out->hall_delta_raw = (int32_t)delta;
    out->hall_progress = progress;
    out->hall_mm = hall_mm;
    return true;
}

esp_err_t sensor_conversion_convert(const sensor_raw_sample_t *raw,
                                    const sensor_conversion_profile_t *profile,
                                    sensor_converted_sample_t *out)
{
    if (raw == NULL || profile == NULL || out == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    memset(out, 0, sizeof(*out));
    out->timestamp_ms = raw->timestamp_ms;
    out->pressure_saturation_mask =
        raw->pressure_saturation_mask & SENSOR_CONVERSION_PRESSURE_SUPPORTED_MASK;

    uint32_t required_mask =
        sensor_conversion_normalize_pressure_mask(profile->required_pressure_mask);
    uint32_t usable_profile_mask = 0u;

    for (size_t channel = 0; channel < SENSOR_CONVERSION_PRESSURE_CHANNEL_COUNT; ++channel) {
        uint32_t bit = 1u << channel;
        bool channel_profile_valid = pressure_channel_profile_valid(profile, channel);
        if (channel_profile_valid) {
            usable_profile_mask |= bit;
        }

        bool saturated = (out->pressure_saturation_mask & bit) != 0u;
        if (raw->pressure_read_valid[channel] &&
            channel_profile_valid &&
            !saturated &&
            convert_pressure_channel(raw->pressure_raw[channel],
                                     profile->pressure_baseline_raw[channel],
                                     profile->pressure_kpa_per_count[channel],
                                     &out->pressure_kpa[channel])) {
            out->pressure_kpa_channel_valid[channel] = true;
            out->pressure_valid_mask |= bit;
        }
    }

    out->pressure_profile_valid =
        pressure_required_channels_valid(usable_profile_mask, required_mask);
    out->pressure_kpa_valid =
        pressure_required_channels_valid(out->pressure_valid_mask, required_mask);
    out->sample_pressure_kpa_valid = out->pressure_kpa_valid;

    out->hall_profile_valid = hall_profile_valid(profile);
    out->hall_mm_valid = convert_hall(raw, profile, out);
    out->sample_hall_mm_valid = out->hall_mm_valid;

    return ESP_OK;
}
