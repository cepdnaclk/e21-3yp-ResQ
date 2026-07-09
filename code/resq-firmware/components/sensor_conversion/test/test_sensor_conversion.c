#include "unity.h"

#include "sensor_conversion.h"

static calibration_config_t conversion_config(void)
{
    calibration_config_t config = {0};
    calibration_config_set_defaults(&config);
    config.pressure_0_baseline = 1000;
    config.pressure_1_baseline = 2000;
    config.pressure_2_baseline = 3000;
    config.pressure_0_kpa_per_count = 0.10f;
    config.pressure_1_kpa_per_count = 0.20f;
    config.pressure_2_kpa_per_count = 0.30f;
    config.hall_baseline = 1000;
    config.hall_range_raw = 500;
    config.hall_direction = 1;
    config.full_depth_mm = 50.0f;
    return config;
}

TEST_CASE("pressure_to_kpa converts positive and negative deltas", "[sensor_conversion]")
{
    float kpa = 0.0f;
    TEST_ASSERT_EQUAL(ESP_OK, sensor_conversion_pressure_to_kpa(1250, 1000, 0.01f, &kpa));
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 2.5f, kpa);

    TEST_ASSERT_EQUAL(ESP_OK, sensor_conversion_pressure_to_kpa(750, 1000, 0.01f, &kpa));
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 2.5f, kpa);
}

TEST_CASE("pressure_to_kpa rejects zero scale and saturated raw", "[sensor_conversion]")
{
    float kpa = 1.0f;
    TEST_ASSERT_NOT_EQUAL(ESP_OK, sensor_conversion_pressure_to_kpa(1250, 1000, 0.0f, &kpa));
    TEST_ASSERT_EQUAL_FLOAT(0.0f, kpa);

    TEST_ASSERT_TRUE(sensor_conversion_pressure_raw_is_saturated(8300000));
    TEST_ASSERT_TRUE(sensor_conversion_pressure_raw_is_saturated(8300001));
    TEST_ASSERT_NOT_EQUAL(ESP_OK, sensor_conversion_pressure_to_kpa(8300000, 1000, 0.01f, &kpa));
}

TEST_CASE("hall_to_mm converts and clamps with direction", "[sensor_conversion]")
{
    float mm = 0.0f;
    float progress = 0.0f;
    int32_t delta = 0;

    TEST_ASSERT_EQUAL(ESP_OK, sensor_conversion_hall_to_mm(1250, 1000, 500, 1, 50.0f, &mm, &progress, &delta));
    TEST_ASSERT_EQUAL(250, delta);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.5f, progress);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 25.0f, mm);

    TEST_ASSERT_EQUAL(ESP_OK, sensor_conversion_hall_to_mm(750, 1000, 500, -1, 50.0f, &mm, &progress, &delta));
    TEST_ASSERT_EQUAL(250, delta);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 25.0f, mm);

    TEST_ASSERT_EQUAL(ESP_OK, sensor_conversion_hall_to_mm(2000, 1000, 500, 1, 50.0f, &mm, &progress, &delta));
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 1.0f, progress);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 50.0f, mm);

    TEST_ASSERT_EQUAL(ESP_OK, sensor_conversion_hall_to_mm(900, 1000, 500, 1, 50.0f, &mm, &progress, &delta));
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.0f, progress);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.0f, mm);
}

TEST_CASE("convert_sample returns converted values and validity flags", "[sensor_conversion]")
{
    calibration_config_t config = conversion_config();
    sensor_raw_sample_t raw = {
        .pressure_0_raw = 1010,
        .pressure_1_raw = 2020,
        .pressure_2_raw = 3030,
        .hall_raw = 1250,
        .ts_ms = 1234,
    };
    sensor_converted_sample_t converted = {0};

    TEST_ASSERT_EQUAL(ESP_OK, sensor_conversion_convert_sample(&raw, &config, &converted));
    TEST_ASSERT_TRUE(converted.pressure_kpa_valid);
    TEST_ASSERT_TRUE(converted.hall_mm_valid);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 1.0f, converted.pressure_0_kpa);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 4.0f, converted.pressure_1_kpa);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 9.0f, converted.pressure_2_kpa);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 25.0f, converted.hall_mm);

    config.pressure_1_kpa_per_count = 0.0f;
    TEST_ASSERT_EQUAL(ESP_OK, sensor_conversion_convert_sample(&raw, &config, &converted));
    TEST_ASSERT_FALSE(converted.pressure_1_kpa_valid);
    TEST_ASSERT_FALSE(converted.pressure_kpa_valid);
    TEST_ASSERT_TRUE(converted.hall_mm_valid);

    config = conversion_config();
    raw.quality_flags = SENSOR_CONVERSION_QUALITY_PRESSURE_READ_FAILED;
    TEST_ASSERT_EQUAL(ESP_OK, sensor_conversion_convert_sample(&raw, &config, &converted));
    TEST_ASSERT_FALSE(converted.pressure_0_kpa_valid);
    TEST_ASSERT_FALSE(converted.pressure_1_kpa_valid);
    TEST_ASSERT_FALSE(converted.pressure_2_kpa_valid);
    TEST_ASSERT_TRUE(converted.hall_mm_valid);

    raw.quality_flags = SENSOR_CONVERSION_QUALITY_HALL_READ_FAILED;
    TEST_ASSERT_EQUAL(ESP_OK, sensor_conversion_convert_sample(&raw, &config, &converted));
    TEST_ASSERT_TRUE(converted.pressure_kpa_valid);
    TEST_ASSERT_FALSE(converted.hall_mm_valid);
}
