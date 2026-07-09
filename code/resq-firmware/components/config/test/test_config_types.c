#include <string.h>

#include "resq_config_types.h"
#include "states.h"
#include "unity.h"

static calibration_config_t valid_calibration(void)
{
    calibration_config_t config = {
        .hall_baseline = 10000,
        .hall_full_press = 8000,
        .hall_range_raw = 2000,
        .hall_direction = -1,
        .hall_start_delta = 300,
        .hall_full_delta_threshold = 1500,
        .hall_recoil_delta = 150,
        .ref_pressure = 10000,
        .bladder_1_pressure = 10000,
        .bladder_2_pressure = 10000,
        .bladder_1_full_press = 14000,
        .bladder_2_full_press = 14000,
        .pressure_1_range_raw = 4000,
        .pressure_2_range_raw = 4000,
        .pressure_contact_threshold = 300,
        .pressure_valid_threshold = 1000,
        .pressure_balance_allowed_pct = 25,
        .pressure_mode = CALIBRATION_PRESSURE_OPTIONAL,
        .pressure_valid = true,
        .hall_valid = true,
        .full_depth_mm = 50.0f,
        .calibrated_at_ms = 1000,
        .calibrated = true,
    };
    return config;
}

TEST_CASE("Network defaults and validation update provisioned", "[config]")
{
    network_config_t config;
    memset(&config, 0xA5, sizeof(config));
    network_config_set_defaults(&config);
    TEST_ASSERT_FALSE(config.provisioned);
    TEST_ASSERT_EQUAL_CHAR('\0', config.wifi_ssid[0]);
    TEST_ASSERT_FALSE(network_config_validate(NULL));
    TEST_ASSERT_FALSE(network_config_validate(&config));

    strcpy(config.wifi_ssid, "ssid");
    strcpy(config.backend_base_url, "http://hub");
    TEST_ASSERT_TRUE(network_config_validate(&config));
    TEST_ASSERT_TRUE(config.provisioned);
}

TEST_CASE("Calibration defaults are safe and explicit", "[config]")
{
    calibration_config_t config;
    memset(&config, 0xA5, sizeof(config));
    calibration_config_set_defaults(&config);
    TEST_ASSERT_FALSE(config.calibrated);
    TEST_ASSERT_EQUAL(25, config.pressure_balance_allowed_pct);
    TEST_ASSERT_EQUAL(CALIBRATION_PRESSURE_OPTIONAL, config.pressure_mode);
    TEST_ASSERT_TRUE(config.pressure_valid);
    TEST_ASSERT_FALSE(config.pressure_degraded);
    TEST_ASSERT_FALSE(config.using_last_stable_pressure);
    TEST_ASSERT_FALSE(config.hall_valid);
    TEST_ASSERT_EQUAL_FLOAT(0.0f, config.pressure_0_kpa_per_count);
    TEST_ASSERT_EQUAL_FLOAT(0.0f, config.pressure_1_kpa_per_count);
    TEST_ASSERT_EQUAL_FLOAT(0.0f, config.pressure_2_kpa_per_count);
    TEST_ASSERT_EQUAL_FLOAT(50.0f, config.full_depth_mm);
    TEST_ASSERT_EQUAL(60, config.calibration_sample_count);
    TEST_ASSERT_EQUAL(2000, config.calibration_window_ms);
}

#define ASSERT_INVALID_FIELD(field, value) do { \
    calibration_config_t invalid = valid_calibration(); \
    invalid.field = (value); \
    TEST_ASSERT_FALSE(calibration_config_validate(&invalid)); \
    TEST_ASSERT_FALSE(invalid.calibrated); \
} while (0)

TEST_CASE("Calibration validation covers every threshold boundary", "[config]")
{
    calibration_config_t config = valid_calibration();
    TEST_ASSERT_TRUE(calibration_config_validate(&config));
    TEST_ASSERT_FALSE(calibration_config_validate(NULL));

    ASSERT_INVALID_FIELD(hall_baseline, 0);
    ASSERT_INVALID_FIELD(hall_full_press, 0);
    ASSERT_INVALID_FIELD(hall_range_raw, 30);
    ASSERT_INVALID_FIELD(hall_direction, 0);
    ASSERT_INVALID_FIELD(hall_start_delta, 0);
    ASSERT_INVALID_FIELD(hall_full_delta_threshold, 300);
    ASSERT_INVALID_FIELD(hall_recoil_delta, 0);
    ASSERT_INVALID_FIELD(ref_pressure, 0);
    ASSERT_INVALID_FIELD(bladder_1_pressure, 0);
    ASSERT_INVALID_FIELD(bladder_2_pressure, 0);
    ASSERT_INVALID_FIELD(bladder_1_full_press, 0);
    ASSERT_INVALID_FIELD(bladder_2_full_press, 0);
    ASSERT_INVALID_FIELD(pressure_1_range_raw, 300);
    ASSERT_INVALID_FIELD(pressure_2_range_raw, 300);
    ASSERT_INVALID_FIELD(pressure_contact_threshold, 0);
    ASSERT_INVALID_FIELD(pressure_valid_threshold, 300);
    ASSERT_INVALID_FIELD(pressure_balance_allowed_pct, 4);
    ASSERT_INVALID_FIELD(pressure_balance_allowed_pct, 61);
    ASSERT_INVALID_FIELD(full_depth_mm, 0.0f);
    ASSERT_INVALID_FIELD(calibrated_at_ms, 0);

    config = valid_calibration();
    config.pressure_0_kpa_per_count = 0.0f;
    config.pressure_1_kpa_per_count = 0.0f;
    config.pressure_2_kpa_per_count = 0.0f;
    TEST_ASSERT_TRUE(calibration_config_validate(&config));
}

TEST_CASE("All firmware states have stable string names", "[config][fsm]")
{
    const char *expected[] = {
        "BOOT", "CONFIG_CHECK", "PROVISIONING", "FLUSH_CONFIG",
        "WIFI_CONNECTING", "BACKEND_REGISTERING", "MQTT_CONNECTING",
        "PAIRED_IDLE", "CALIBRATING", "CALIBRATION_FAIL",
        "READY_FOR_SESSION", "SESSION_ACTIVE", "SESSION_INTERRUPTED",
        "ERROR", "RESETTING", "TURN_OFF"
    };
    for (int state = RESQ_STATE_BOOT; state <= RESQ_STATE_TURN_OFF; state++) {
        TEST_ASSERT_EQUAL_STRING(expected[state],
                                 resq_state_to_string((resq_state_t)state));
    }
    TEST_ASSERT_EQUAL_STRING("UNKNOWN", resq_state_to_string((resq_state_t)99));
}
