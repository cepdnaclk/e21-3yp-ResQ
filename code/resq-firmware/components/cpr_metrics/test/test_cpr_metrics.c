#include <string.h>

#include "cpr_metrics.h"
#include "unity.h"

static calibration_config_t metrics_calibration(void)
{
    calibration_config_t config = {
        .hall_baseline = 1000,
        .hall_range_raw = 1000,
        .hall_direction = 1,
        .hall_start_delta = 300,
        .hall_full_delta_threshold = 800,
        .hall_recoil_delta = 100,
        .pressure_1_baseline = 1000,
        .pressure_2_baseline = 1000,
        .pressure_contact_threshold = 100,
        .pressure_valid_threshold = 500,
        .pressure_balance_allowed_pct = 20,
    };
    return config;
}

static void update(int32_t hall, int32_t p1, int32_t p2, int64_t ts)
{
    cpr_sensor_sample_t sample = {
        .hall_raw = hall,
        .pressure_1_raw = p1,
        .pressure_2_raw = p2,
        .ts_ms = ts,
    };
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_update(&sample));
}

TEST_CASE("CPR metrics validates lifecycle inputs", "[metrics]")
{
    calibration_config_t calibration = metrics_calibration();
    cpr_metrics_snapshot_t snapshot;
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_init());
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, cpr_metrics_reset(NULL));
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_reset(&calibration));
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, cpr_metrics_update(NULL));
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, cpr_metrics_get_snapshot(NULL));
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_EQUAL(0, snapshot.total_compressions);
}

TEST_CASE("CPR metrics tracks valid compression recoil depth and rate", "[metrics]")
{
    calibration_config_t calibration = metrics_calibration();
    cpr_metrics_snapshot_t snapshot;
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_init());
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_reset(&calibration));

    update(1400, 1600, 1600, 1000);
    update(1900, 1700, 1700, 1100);
    update(1200, 1200, 1200, 1200);
    update(1000, 1000, 1000, 1300);
    update(1400, 1600, 1600, 1500);

    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_EQUAL(2, snapshot.total_compressions);
    TEST_ASSERT_EQUAL(1, snapshot.valid_compressions);
    TEST_ASSERT_EQUAL(1, snapshot.recoil_ok_count);
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 120.0f, snapshot.rate_cpm);
    TEST_ASSERT_EQUAL_STRING("CENTER", snapshot.hand_placement);
}

TEST_CASE("CPR metrics classifies contact imbalance and clamps depth", "[metrics]")
{
    calibration_config_t calibration = metrics_calibration();
    cpr_metrics_snapshot_t snapshot;
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_init());
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_reset(&calibration));

    update(2500, 2000, 1100, 1000);
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 1.0f, snapshot.depth_progress);
    TEST_ASSERT_NOT_EQUAL(0, strcmp("CENTER", snapshot.hand_placement));

    update(1000, 1050, 1050, 1100);
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_EQUAL_STRING("NO_CONTACT", snapshot.hand_placement);
}
