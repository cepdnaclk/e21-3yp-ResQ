#include <limits.h>
#include <string.h>

#include "pressure_quality_filter.h"
#include "unity.h"

static pressure_quality_config_t test_config(uint8_t required_mask)
{
    pressure_quality_config_t config = {
        .window_size = 3,
        .required_channel_mask = required_mask,
        .min_raw = {-10000, -10000, -10000},
        .max_raw = {10000, 10000, 10000},
        .max_spread_raw = {20, 20, 20},
    };
    return config;
}

static pressure_quality_result_t push(
    pressure_quality_filter_t *filter,
    int32_t p0,
    int32_t p1,
    int32_t p2,
    uint8_t valid_mask,
    uint8_t saturation_mask,
    int64_t timestamp_ms)
{
    pressure_raw_frame_t frame = {
        .raw = {p0, p1, p2},
        .read_valid_mask = valid_mask,
        .saturation_mask = saturation_mask,
        .timestamp_ms = timestamp_ms,
    };
    pressure_quality_result_t result;
    TEST_ASSERT_EQUAL(
        ESP_OK, pressure_quality_filter_push(filter, &frame, &result));
    return result;
}

TEST_CASE("single pressure frame is not a stable window", "[pressure_quality]")
{
    pressure_quality_filter_t filter;
    pressure_quality_config_t config = test_config(PRESSURE_CHANNEL_MASK_ALL);
    TEST_ASSERT_EQUAL(ESP_OK, pressure_quality_filter_init(&filter, &config));

    pressure_quality_result_t result =
        push(&filter, 100, 200, 300, 0x07, 0, 1);
    TEST_ASSERT_FALSE(result.stable_window_ready);
    TEST_ASSERT_FALSE(result.all_required_channels_usable);
    TEST_ASSERT_FALSE(result.has_last_accepted);
}

TEST_CASE("complete stable pressure window is accepted", "[pressure_quality]")
{
    pressure_quality_filter_t filter;
    pressure_quality_config_t config = test_config(PRESSURE_CHANNEL_MASK_ALL);
    TEST_ASSERT_EQUAL(ESP_OK, pressure_quality_filter_init(&filter, &config));

    push(&filter, 100, 200, 300, 0x07, 0, 1);
    push(&filter, 102, 202, 302, 0x07, 0, 2);
    pressure_quality_result_t result =
        push(&filter, 104, 204, 304, 0x07, 0, 3);

    TEST_ASSERT_TRUE(result.stable_window_ready);
    TEST_ASSERT_TRUE(result.all_required_channels_usable);
    TEST_ASSERT_EQUAL_HEX8(0x07, result.decision_usable_mask);
    TEST_ASSERT_EQUAL_INT32(102, result.accepted_raw[0]);
    TEST_ASSERT_EQUAL_UINT32(1, result.accepted_sample_count);
}

TEST_CASE("invalid pressure does not overwrite last accepted", "[pressure_quality]")
{
    pressure_quality_filter_t filter;
    pressure_quality_config_t config = test_config(PRESSURE_CHANNEL_MASK_ALL);
    TEST_ASSERT_EQUAL(ESP_OK, pressure_quality_filter_init(&filter, &config));

    push(&filter, 100, 200, 300, 0x07, 0, 1);
    push(&filter, 100, 200, 300, 0x07, 0, 2);
    push(&filter, 100, 200, 300, 0x07, 0, 3);
    pressure_quality_result_t result =
        push(&filter, 0, 0, 0, 0x00, 0, 4);

    TEST_ASSERT_FALSE(result.all_required_channels_usable);
    TEST_ASSERT_TRUE(result.using_last_accepted);
    TEST_ASSERT_EQUAL_INT32(100, result.accepted_raw[0]);
    TEST_ASSERT_EQUAL_INT32(200, result.accepted_raw[1]);
    TEST_ASSERT_EQUAL_INT32(300, result.accepted_raw[2]);
    TEST_ASSERT_EQUAL_INT64(3, result.accepted_timestamp_ms);
}

TEST_CASE("saturated pressure is unusable and preserves evidence",
          "[pressure_quality]")
{
    pressure_quality_filter_t filter;
    pressure_quality_config_t config = test_config(0x06);
    TEST_ASSERT_EQUAL(ESP_OK, pressure_quality_filter_init(&filter, &config));

    push(&filter, 100, 200, 300, 0x07, 0, 1);
    push(&filter, 100, 200, 300, 0x07, 0, 2);
    push(&filter, 100, 200, 300, 0x07, 0, 3);
    pressure_quality_result_t result =
        push(&filter, 100, 9000, 9000, 0x07, 0x06, 4);

    TEST_ASSERT_EQUAL_HEX8(0x06, result.saturation_mask);
    TEST_ASSERT_FALSE(result.all_required_channels_usable);
    TEST_ASSERT_TRUE(result.using_last_accepted);
    TEST_ASSERT_EQUAL_INT32(200, result.accepted_raw[1]);
}

TEST_CASE("pressure filter recovers after temporary invalid frames",
          "[pressure_quality]")
{
    pressure_quality_filter_t filter;
    pressure_quality_config_t config = test_config(PRESSURE_CHANNEL_MASK_ALL);
    TEST_ASSERT_EQUAL(ESP_OK, pressure_quality_filter_init(&filter, &config));

    push(&filter, 0, 0, 0, 0x00, 0, 1);
    push(&filter, 100, 200, 300, 0x07, 0, 2);
    push(&filter, 102, 202, 302, 0x07, 0, 3);
    pressure_quality_result_t result =
        push(&filter, 104, 204, 304, 0x07, 0, 4);

    TEST_ASSERT_TRUE(result.all_required_channels_usable);
    TEST_ASSERT_EQUAL_UINT32(0, result.consecutive_invalid_count);
}

TEST_CASE("pressure channel validity masks stay independent",
          "[pressure_quality]")
{
    pressure_quality_filter_t filter;
    pressure_quality_config_t config = test_config(0x01);
    TEST_ASSERT_EQUAL(ESP_OK, pressure_quality_filter_init(&filter, &config));

    push(&filter, 100, 200, 300, 0x05, 0, 1);
    push(&filter, 100, 200, 300, 0x05, 0, 2);
    pressure_quality_result_t result =
        push(&filter, 100, 200, 300, 0x05, 0, 3);

    TEST_ASSERT_EQUAL_HEX8(0x05, result.channel_valid_mask);
    TEST_ASSERT_EQUAL_HEX8(0x05, result.within_range_mask);
    TEST_ASSERT_EQUAL_HEX8(0x05, result.decision_usable_mask);
    TEST_ASSERT_TRUE(result.all_required_channels_usable);
}

TEST_CASE("invalid zero frames are never accepted", "[pressure_quality]")
{
    pressure_quality_filter_t filter;
    pressure_quality_config_t config = test_config(PRESSURE_CHANNEL_MASK_ALL);
    TEST_ASSERT_EQUAL(ESP_OK, pressure_quality_filter_init(&filter, &config));

    pressure_quality_result_t result = {0};
    for (int i = 0; i < 5; ++i) {
        result = push(&filter, 0, 0, 0, 0x00, 0, i);
    }
    TEST_ASSERT_FALSE(result.has_last_accepted);
    TEST_ASSERT_EQUAL_UINT32(0, result.accepted_sample_count);
}

TEST_CASE("pressure filter reset removes prior compression evidence",
          "[pressure_quality]")
{
    pressure_quality_filter_t filter;
    pressure_quality_config_t config = test_config(0x06);
    TEST_ASSERT_EQUAL(ESP_OK, pressure_quality_filter_init(&filter, &config));

    push(&filter, 100, 200, 300, 0x07, 0, 1);
    push(&filter, 100, 200, 300, 0x07, 0, 2);
    push(&filter, 100, 200, 300, 0x07, 0, 3);
    pressure_quality_filter_reset(&filter);

    int32_t accepted[PRESSURE_CHANNEL_COUNT] = {INT32_MIN, INT32_MIN, INT32_MIN};
    TEST_ASSERT_FALSE(
        pressure_quality_filter_get_last_accepted(&filter, accepted, NULL));
    pressure_quality_result_t result =
        push(&filter, 100, 200, 300, 0x07, 0, 4);
    TEST_ASSERT_FALSE(result.stable_window_ready);
}
