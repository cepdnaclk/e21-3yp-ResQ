#include "calibration_codes.h"
#include "calibration_manager.h"
#include "unity.h"

TEST_CASE("Calibration reason table covers every documented failure", "[calibration]")
{
    const calibration_reason_id_t reasons[] = {
        CAL_REASON_INVALID_CALIBRATION_PAYLOAD,
        CAL_REASON_CALIBRATION_ALREADY_RUNNING,
        CAL_REASON_INVALID_HALL_DELTA,
        CAL_REASON_REF_PRESSURE_TIMEOUT,
        CAL_REASON_BLADDER_1_PRESSURE_TIMEOUT,
        CAL_REASON_BLADDER_2_PRESSURE_TIMEOUT,
        CAL_REASON_HALL_BASELINE_READ_FAILED,
        CAL_REASON_HALL_FULL_PRESS_TIMEOUT,
        CAL_REASON_FULL_PRESS_PRESSURE_READ_FAILED,
        CAL_REASON_PRESSURE_IMBALANCE_TOO_HIGH,
        CAL_REASON_CALIBRATION_VALUES_OUT_OF_RANGE,
        CAL_REASON_SENSOR_STUCK_OR_NOISE,
        CAL_REASON_HALL_RANGE_TOO_SMALL,
        CAL_REASON_HALL_NOISE_TOO_HIGH,
        CAL_REASON_PRESSURE_RANGE_TOO_SMALL,
        CAL_REASON_PRESSURE_NOISE_TOO_HIGH,
        CAL_REASON_ADAPTIVE_THRESHOLD_INVALID,
        CAL_REASON_PRESSURE_SENSOR_SATURATED,
        CAL_REASON_PRESSURE_SENSOR_FLOATING_OR_DISCONNECTED,
        CAL_REASON_PRESSURE_BASELINE_UNSTABLE,
        CAL_REASON_NVS_SAVE_FAILED,
        CAL_REASON_MQTT_DISCONNECTED_DURING_CALIBRATION,
        CAL_REASON_WIFI_DISCONNECTED_DURING_CALIBRATION,
        CAL_REASON_CALIBRATION_CANCELLED,
    };

    for (size_t i = 0; i < sizeof(reasons) / sizeof(reasons[0]); i++) {
        const calibration_reason_entry_t *entry =
            calibration_codes_get_reason_entry(reasons[i]);
        TEST_ASSERT_NOT_NULL(entry);
        TEST_ASSERT_NOT_NULL(entry->reason_code);
        TEST_ASSERT_NOT_NULL(entry->message);
        TEST_ASSERT_NOT_EQUAL(CAL_ACTION_NONE,
                              calibration_codes_default_action_for_reason(
                                  reasons[i]));
    }
}

TEST_CASE("Calibration pressure saturation fallback is documented as a warning", "[calibration]")
{
    const calibration_reason_entry_t *entry =
        calibration_codes_get_reason_entry(
            CAL_REASON_PRESSURE_SENSOR_SATURATED_USING_LAST_STABLE);

    TEST_ASSERT_NOT_NULL(entry);
    TEST_ASSERT_EQUAL(CAL_REASON_PRESSURE_SENSOR_SATURATED_USING_LAST_STABLE,
                      entry->reason_id);
    TEST_ASSERT_EQUAL_STRING("PRESSURE_SENSOR_SATURATED_USING_LAST_STABLE",
                             entry->reason_code);
    TEST_ASSERT_EQUAL(CAL_ACTION_NONE,
                      calibration_codes_default_action_for_reason(
                          CAL_REASON_PRESSURE_SENSOR_SATURATED_USING_LAST_STABLE));
}

TEST_CASE("Calibration code lookups reject unknown IDs", "[calibration]")
{
    TEST_ASSERT_EQUAL(CAL_REASON_NONE,
                      calibration_codes_get_reason_entry(
                          (calibration_reason_id_t)9999)->reason_id);
    TEST_ASSERT_EQUAL_STRING("NONE",
                             calibration_codes_reason_to_string(
                                 (calibration_reason_id_t)9999));
}

TEST_CASE("Calibration start parser accepts the current payload contract", "[calibration]")
{
    calibration_config_t config;
    calibration_reason_id_t reason;
    char command_id[32];
    const char *payload =
        "{"
        "\"request_id\":\"cal-1\","
        "\"hall_delta\":1200,"
        "\"ref_pressure\":10000,"
        "\"bladder_1_pressure\":11000,"
        "\"bladder_2_pressure\":11500,"
        "\"profile_id\":\"adult\","
        "\"pressure_balance_allowed_pct\":30"
        "}";

    TEST_ASSERT_EQUAL(ESP_OK,
                      calibration_manager_parse_start_payload(
                          payload, &config, command_id, sizeof(command_id), &reason));
    TEST_ASSERT_EQUAL(CAL_REASON_NONE, reason);
    TEST_ASSERT_EQUAL_STRING("cal-1", command_id);
    TEST_ASSERT_EQUAL(1200, config.hall_delta);
    TEST_ASSERT_EQUAL_STRING("adult", config.profile_id);
    TEST_ASSERT_EQUAL(30, config.pressure_balance_allowed_pct);
    TEST_ASSERT_EQUAL_FLOAT(50.0f, config.full_depth_mm);
    TEST_ASSERT_EQUAL(CALIBRATION_PRESSURE_OPTIONAL, config.pressure_mode);
    TEST_ASSERT_EQUAL_FLOAT(0.0f, config.pressure_0_kpa_per_count);
    TEST_ASSERT_EQUAL_FLOAT(0.0f, config.pressure_1_kpa_per_count);
    TEST_ASSERT_EQUAL_FLOAT(0.0f, config.pressure_2_kpa_per_count);
    TEST_ASSERT_FALSE(config.calibrated);
}

TEST_CASE("Calibration start parser preserves optional conversion overrides", "[calibration]")
{
    calibration_config_t config;
    calibration_reason_id_t reason;
    char command_id[32];
    const char *payload =
        "{"
        "\"request_id\":\"cal-2\","
        "\"hall_delta\":1200,"
        "\"ref_pressure\":10000,"
        "\"bladder_1_pressure\":11000,"
        "\"bladder_2_pressure\":11500,"
        "\"full_depth_mm\":55.5,"
        "\"pressure_0_kpa_per_count\":0.00000012,"
        "\"pressure_1_kpa_per_count\":0.00000023,"
        "\"pressure_2_kpa_per_count\":0.00000034"
        "}";

    TEST_ASSERT_EQUAL(ESP_OK,
                      calibration_manager_parse_start_payload(
                          payload, &config, command_id, sizeof(command_id), &reason));
    TEST_ASSERT_EQUAL(CAL_REASON_NONE, reason);
    TEST_ASSERT_EQUAL_STRING("cal-2", command_id);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 55.5f, config.full_depth_mm);
    TEST_ASSERT_FLOAT_WITHIN(0.00000001f, 0.00000012f, config.pressure_0_kpa_per_count);
    TEST_ASSERT_FLOAT_WITHIN(0.00000001f, 0.00000023f, config.pressure_1_kpa_per_count);
    TEST_ASSERT_FLOAT_WITHIN(0.00000001f, 0.00000034f, config.pressure_2_kpa_per_count);
}

TEST_CASE("Calibration start parser rejects malformed and unsafe values", "[calibration]")
{
    calibration_config_t config;
    calibration_reason_id_t reason;
    char command_id[32];

    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
                      calibration_manager_parse_start_payload(
                          NULL, &config, command_id, sizeof(command_id), &reason));
    TEST_ASSERT_EQUAL(CAL_REASON_INVALID_CALIBRATION_PAYLOAD, reason);

    TEST_ASSERT_EQUAL(ESP_FAIL,
                      calibration_manager_parse_start_payload(
                          "{bad", &config, command_id, sizeof(command_id), &reason));
    TEST_ASSERT_EQUAL(CAL_REASON_INVALID_CALIBRATION_PAYLOAD, reason);

    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
                      calibration_manager_parse_start_payload(
                          "{\"command_id\":\"x\",\"hall_delta\":0,"
                          "\"ref_pressure\":1,\"bladder_1_pressure\":1,"
                          "\"bladder_2_pressure\":1}",
                          &config, command_id, sizeof(command_id), &reason));
    TEST_ASSERT_EQUAL(CAL_REASON_INVALID_HALL_DELTA, reason);

    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
                      calibration_manager_parse_start_payload(
                          "{\"command_id\":\"x\",\"hall_delta\":4096,"
                          "\"ref_pressure\":1,\"bladder_1_pressure\":1,"
                          "\"bladder_2_pressure\":1}",
                          &config, command_id, sizeof(command_id), &reason));
    TEST_ASSERT_EQUAL(CAL_REASON_INVALID_HALL_DELTA, reason);

    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
                      calibration_manager_parse_start_payload(
                          "{\"command_id\":\"x\",\"hall_delta\":620,"
                          "\"ref_pressure\":0,\"bladder_1_pressure\":1,"
                          "\"bladder_2_pressure\":1}",
                          &config, command_id, sizeof(command_id), &reason));
    TEST_ASSERT_EQUAL(CAL_REASON_INVALID_CALIBRATION_PAYLOAD, reason);
}
