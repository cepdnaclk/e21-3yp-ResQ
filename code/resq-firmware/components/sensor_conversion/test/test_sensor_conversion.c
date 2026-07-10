#include "unity.h"

#include <limits.h>
#include <math.h>

#include "sensor_conversion.h"

static sensor_raw_sample_t make_raw_sample(void)
{
    sensor_raw_sample_t raw = {
        .pressure_raw = {1100, 2100, 3100},
        .pressure_read_valid = {true, true, true},
        .hall_raw = 1250,
        .hall_read_valid = true,
        .pressure_saturation_mask = 0u,
        .timestamp_ms = 123456789,
    };
    return raw;
}

static sensor_conversion_profile_t make_profile(void)
{
    sensor_conversion_profile_t profile = {
        .pressure_baseline_raw = {1000, 2000, 3000},
        .pressure_baseline_valid = {true, true, true},
        .pressure_kpa_per_count = {0.01f, 0.02f, 0.03f},
        .hall_baseline_raw = 1000,
        .hall_baseline_valid = true,
        .hall_range_raw = 500,
        .hall_direction = 1,
        .full_depth_mm = 50.0f,
        .required_pressure_mask = SENSOR_CONVERSION_PRESSURE_DEFAULT_REQUIRED_MASK,
    };
    return profile;
}

static sensor_converted_sample_t convert_ok(sensor_raw_sample_t *raw,
                                            sensor_conversion_profile_t *profile)
{
    sensor_converted_sample_t out = {0};
    TEST_ASSERT_EQUAL(ESP_OK, sensor_conversion_convert(raw, profile, &out));
    return out;
}

TEST_CASE("pressure conversion uses absolute raw difference", "[sensor_conversion]")
{
    sensor_raw_sample_t raw = make_raw_sample();
    sensor_conversion_profile_t profile = make_profile();

    raw.pressure_raw[0] = 1100;
    sensor_converted_sample_t out = convert_ok(&raw, &profile);
    TEST_ASSERT_TRUE(out.pressure_kpa_channel_valid[0]);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 1.0f, out.pressure_kpa[0]);

    raw.pressure_raw[0] = 900;
    out = convert_ok(&raw, &profile);
    TEST_ASSERT_TRUE(out.pressure_kpa_channel_valid[0]);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 1.0f, out.pressure_kpa[0]);
}

TEST_CASE("pressure conversion applies independent coefficients", "[sensor_conversion]")
{
    sensor_raw_sample_t raw = make_raw_sample();
    sensor_conversion_profile_t profile = make_profile();
    sensor_converted_sample_t out = convert_ok(&raw, &profile);

    TEST_ASSERT_FLOAT_WITHIN(0.001f, 1.0f, out.pressure_kpa[0]);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 2.0f, out.pressure_kpa[1]);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 3.0f, out.pressure_kpa[2]);
}

TEST_CASE("pressure channels fail independently for reads and saturation", "[sensor_conversion]")
{
    sensor_raw_sample_t raw = make_raw_sample();
    sensor_conversion_profile_t profile = make_profile();

    raw.pressure_read_valid[1] = false;
    sensor_converted_sample_t out = convert_ok(&raw, &profile);
    TEST_ASSERT_TRUE(out.pressure_kpa_channel_valid[0]);
    TEST_ASSERT_FALSE(out.pressure_kpa_channel_valid[1]);
    TEST_ASSERT_TRUE(out.pressure_kpa_channel_valid[2]);
    TEST_ASSERT_EQUAL(0x05u, out.pressure_valid_mask);
    TEST_ASSERT_FALSE(out.pressure_kpa_valid);

    raw = make_raw_sample();
    raw.pressure_saturation_mask = 0x04u;
    out = convert_ok(&raw, &profile);
    TEST_ASSERT_TRUE(out.pressure_kpa_channel_valid[0]);
    TEST_ASSERT_TRUE(out.pressure_kpa_channel_valid[1]);
    TEST_ASSERT_FALSE(out.pressure_kpa_channel_valid[2]);
    TEST_ASSERT_EQUAL(0x04u, out.pressure_saturation_mask);
}

TEST_CASE("invalid pressure profile fields invalidate only that channel", "[sensor_conversion]")
{
    sensor_raw_sample_t raw = make_raw_sample();
    sensor_conversion_profile_t profile = make_profile();

    profile.pressure_kpa_per_count[1] = 0.0f;
    sensor_converted_sample_t out = convert_ok(&raw, &profile);
    TEST_ASSERT_FALSE(out.pressure_kpa_channel_valid[1]);

    profile = make_profile();
    profile.pressure_kpa_per_count[1] = -0.01f;
    out = convert_ok(&raw, &profile);
    TEST_ASSERT_FALSE(out.pressure_kpa_channel_valid[1]);

    profile = make_profile();
    profile.pressure_kpa_per_count[1] = NAN;
    out = convert_ok(&raw, &profile);
    TEST_ASSERT_FALSE(out.pressure_kpa_channel_valid[1]);

    profile = make_profile();
    profile.pressure_kpa_per_count[1] = INFINITY;
    out = convert_ok(&raw, &profile);
    TEST_ASSERT_FALSE(out.pressure_kpa_channel_valid[1]);

    profile = make_profile();
    profile.pressure_baseline_valid[1] = false;
    out = convert_ok(&raw, &profile);
    TEST_ASSERT_TRUE(out.pressure_kpa_channel_valid[0]);
    TEST_ASSERT_FALSE(out.pressure_kpa_channel_valid[1]);
    TEST_ASSERT_TRUE(out.pressure_kpa_channel_valid[2]);
}

TEST_CASE("required pressure mask controls aggregate validity", "[sensor_conversion]")
{
    sensor_raw_sample_t raw = make_raw_sample();
    sensor_conversion_profile_t profile = make_profile();

    raw.pressure_read_valid[2] = false;
    profile.required_pressure_mask = 0x07u;
    sensor_converted_sample_t out = convert_ok(&raw, &profile);
    TEST_ASSERT_FALSE(out.pressure_kpa_valid);
    TEST_ASSERT_FALSE(out.sample_pressure_kpa_valid);

    profile.required_pressure_mask = 0x03u;
    out = convert_ok(&raw, &profile);
    TEST_ASSERT_TRUE(out.pressure_kpa_valid);
    TEST_ASSERT_TRUE(out.sample_pressure_kpa_valid);

    profile.required_pressure_mask = 0u;
    out = convert_ok(&raw, &profile);
    TEST_ASSERT_FALSE(out.pressure_kpa_valid);
    TEST_ASSERT_EQUAL(0x07u, sensor_conversion_normalize_pressure_mask(0u));
}

TEST_CASE("hall conversion handles direction and clamping", "[sensor_conversion]")
{
    sensor_raw_sample_t raw = make_raw_sample();
    sensor_conversion_profile_t profile = make_profile();

    sensor_converted_sample_t out = convert_ok(&raw, &profile);
    TEST_ASSERT_TRUE(out.hall_mm_valid);
    TEST_ASSERT_EQUAL(250, out.hall_delta_raw);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.5f, out.hall_progress);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 25.0f, out.hall_mm);

    raw.hall_raw = 750;
    profile.hall_direction = -1;
    out = convert_ok(&raw, &profile);
    TEST_ASSERT_EQUAL(250, out.hall_delta_raw);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.5f, out.hall_progress);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 25.0f, out.hall_mm);

    raw.hall_raw = 900;
    profile.hall_direction = 1;
    out = convert_ok(&raw, &profile);
    TEST_ASSERT_TRUE(out.hall_mm_valid);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.0f, out.hall_progress);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.0f, out.hall_mm);

    raw.hall_raw = 2000;
    out = convert_ok(&raw, &profile);
    TEST_ASSERT_TRUE(out.hall_mm_valid);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 1.0f, out.hall_progress);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 50.0f, out.hall_mm);
}

TEST_CASE("invalid hall input or profile clears hall outputs", "[sensor_conversion]")
{
    sensor_raw_sample_t raw = make_raw_sample();
    sensor_conversion_profile_t profile = make_profile();

    raw.hall_read_valid = false;
    sensor_converted_sample_t out = convert_ok(&raw, &profile);
    TEST_ASSERT_TRUE(out.hall_profile_valid);
    TEST_ASSERT_FALSE(out.hall_mm_valid);
    TEST_ASSERT_FALSE(out.sample_hall_mm_valid);
    TEST_ASSERT_EQUAL(0, out.hall_delta_raw);
    TEST_ASSERT_EQUAL_FLOAT(0.0f, out.hall_progress);
    TEST_ASSERT_EQUAL_FLOAT(0.0f, out.hall_mm);

    raw = make_raw_sample();
    profile.hall_range_raw = 0;
    out = convert_ok(&raw, &profile);
    TEST_ASSERT_FALSE(out.hall_profile_valid);
    TEST_ASSERT_FALSE(out.hall_mm_valid);

    profile = make_profile();
    profile.hall_direction = 0;
    out = convert_ok(&raw, &profile);
    TEST_ASSERT_FALSE(out.hall_profile_valid);

    profile.hall_direction = 2;
    out = convert_ok(&raw, &profile);
    TEST_ASSERT_FALSE(out.hall_profile_valid);
}

TEST_CASE("invalid full depth invalidates hall profile", "[sensor_conversion]")
{
    sensor_raw_sample_t raw = make_raw_sample();
    sensor_conversion_profile_t profile = make_profile();

    profile.full_depth_mm = 0.0f;
    sensor_converted_sample_t out = convert_ok(&raw, &profile);
    TEST_ASSERT_FALSE(out.hall_profile_valid);

    profile.full_depth_mm = -1.0f;
    out = convert_ok(&raw, &profile);
    TEST_ASSERT_FALSE(out.hall_profile_valid);

    profile.full_depth_mm = NAN;
    out = convert_ok(&raw, &profile);
    TEST_ASSERT_FALSE(out.hall_profile_valid);

    profile.full_depth_mm = INFINITY;
    out = convert_ok(&raw, &profile);
    TEST_ASSERT_FALSE(out.hall_profile_valid);
}

TEST_CASE("null pointers return explicit errors", "[sensor_conversion]")
{
    sensor_raw_sample_t raw = make_raw_sample();
    sensor_conversion_profile_t profile = make_profile();
    sensor_converted_sample_t out = {0};

    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, sensor_conversion_convert(NULL, &profile, &out));
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, sensor_conversion_convert(&raw, NULL, &out));
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, sensor_conversion_convert(&raw, &profile, NULL));
}

TEST_CASE("extreme integer values avoid overflow and propagate timestamp", "[sensor_conversion]")
{
    sensor_raw_sample_t raw = make_raw_sample();
    sensor_conversion_profile_t profile = make_profile();
    raw.pressure_raw[0] = INT32_MIN;
    profile.pressure_baseline_raw[0] = INT32_MAX;
    profile.pressure_kpa_per_count[0] = 0.000001f;
    raw.hall_raw = INT32_MAX;
    profile.hall_baseline_raw = INT32_MIN;
    profile.hall_direction = 1;
    raw.timestamp_ms = 9876543210LL;

    sensor_converted_sample_t out = convert_ok(&raw, &profile);
    TEST_ASSERT_TRUE(out.pressure_kpa_channel_valid[0]);
    TEST_ASSERT_TRUE(isfinite(out.pressure_kpa[0]));
    TEST_ASSERT_FALSE(out.hall_mm_valid);
    TEST_ASSERT_EQUAL(9876543210LL, out.timestamp_ms);
}
