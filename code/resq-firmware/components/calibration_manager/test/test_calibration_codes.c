#include "calibration_codes.h"
#include "calibration_manager.h"
#include <limits.h>
#include <string.h>
#include "unity.h"

TEST_CASE("Calibration reason table covers every documented failure",
          "[calibration]") {
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
    TEST_ASSERT_NOT_EQUAL(
        CAL_ACTION_NONE,
        calibration_codes_default_action_for_reason(reasons[i]));
  }
}

TEST_CASE("Calibration pressure saturation fallback is documented as a warning",
          "[calibration]") {
  const calibration_reason_entry_t *entry = calibration_codes_get_reason_entry(
      CAL_REASON_PRESSURE_SENSOR_SATURATED_USING_LAST_STABLE);

  TEST_ASSERT_NOT_NULL(entry);
  TEST_ASSERT_EQUAL(CAL_REASON_PRESSURE_SENSOR_SATURATED_USING_LAST_STABLE,
                    entry->reason_id);
  TEST_ASSERT_EQUAL_STRING("PRESSURE_SENSOR_SATURATED_USING_LAST_STABLE",
                           entry->reason_code);
  TEST_ASSERT_EQUAL(
      CAL_ACTION_NONE,
      calibration_codes_default_action_for_reason(
          CAL_REASON_PRESSURE_SENSOR_SATURATED_USING_LAST_STABLE));
}

TEST_CASE("Calibration code lookups reject unknown IDs", "[calibration]") {
  TEST_ASSERT_EQUAL(CAL_REASON_NONE, calibration_codes_get_reason_entry(
                                         (calibration_reason_id_t)9999)
                                         ->reason_id);
  TEST_ASSERT_EQUAL_STRING("NONE", calibration_codes_reason_to_string(
                                       (calibration_reason_id_t)9999));
}

TEST_CASE("Calibration start parser accepts the current payload contract",
          "[calibration]") {
  calibration_config_t config;
  calibration_reason_id_t reason;
  char command_id[32];
  const char *payload = "{"
                        "\"request_id\":\"cal-1\","
                        "\"hall_delta\":13500,"
                        "\"ref_pressure\":10000,"
                        "\"bladder_1_pressure\":11000,"
                        "\"bladder_2_pressure\":11500,"
                        "\"profile_id\":\"adult\","
                        "\"profile_version\":1,"
                        "\"profile_hash\":\"0123456789abcdef0123456789abcdef"
                        "0123456789abcdef0123456789abcdef\","
                        "\"pressure_mode\":\"OPTIONAL\","
                        "\"hall_delta_sample_count\":20,"
                        "\"calibration_sample_count\":20,"
                        "\"calibration_window_ms\":3000,"
                        "\"pressure_balance_allowed_pct\":30"
                        "}";

  TEST_ASSERT_EQUAL(
      ESP_OK, calibration_manager_parse_start_payload(
                  payload, &config, command_id, sizeof(command_id), &reason));
  TEST_ASSERT_EQUAL(CAL_REASON_NONE, reason);
  TEST_ASSERT_EQUAL_STRING("cal-1", command_id);
  TEST_ASSERT_EQUAL(675, config.hall_delta);
  TEST_ASSERT_EQUAL_STRING("adult", config.profile_id);
  TEST_ASSERT_EQUAL(30, config.pressure_balance_allowed_pct);
  TEST_ASSERT_EQUAL(20, config.calibration_sample_count);
  TEST_ASSERT_EQUAL(3000, config.calibration_window_ms);
  TEST_ASSERT_EQUAL_FLOAT(50.0f, config.full_depth_mm);
  TEST_ASSERT_EQUAL(CALIBRATION_PRESSURE_OPTIONAL, config.pressure_mode);
  TEST_ASSERT_EQUAL_FLOAT(0.0f, config.pressure_0_kpa_per_count);
  TEST_ASSERT_EQUAL_FLOAT(0.0f, config.pressure_1_kpa_per_count);
  TEST_ASSERT_EQUAL_FLOAT(0.0f, config.pressure_2_kpa_per_count);
  TEST_ASSERT_FALSE(config.calibrated);
}

TEST_CASE("Calibration start parser accepts explicit hall_delta_sum contract",
          "[calibration]") {
  calibration_config_t config;
  calibration_reason_id_t reason;
  char command_id[32];
  const char *payload = "{"
                        "\"request_id\":\"cal-sum\","
                        "\"hall_delta_sum\":13500,"
                        "\"hall_delta_sample_count\":20,"
                        "\"pressure_mode\":\"HALL_ONLY\","
                        "\"profile_id\":\"adult\","
                        "\"profile_version\":1,"
                        "\"profile_hash\":\"0123456789abcdef0123456789abcdef"
                        "0123456789abcdef0123456789abcdef\""
                        "}";

  TEST_ASSERT_EQUAL(
      ESP_OK, calibration_manager_parse_start_payload(
                  payload, &config, command_id, sizeof(command_id), &reason));
  TEST_ASSERT_EQUAL(CAL_REASON_NONE, reason);
  TEST_ASSERT_EQUAL_STRING("cal-sum", command_id);
  TEST_ASSERT_EQUAL(675, config.hall_delta);
  TEST_ASSERT_EQUAL(CALIBRATION_HALL_ONLY, config.pressure_mode);
}

TEST_CASE("Calibration start parser preserves optional conversion overrides",
          "[calibration]") {
  calibration_config_t config;
  calibration_reason_id_t reason;
  char command_id[32];
  const char *payload = "{"
                        "\"request_id\":\"cal-2\","
                        "\"hall_delta\":1200,"
                        "\"ref_pressure\":10000,"
                        "\"bladder_1_pressure\":11000,"
                        "\"bladder_2_pressure\":11500,"
                        "\"profile_id\":\"adult\","
                        "\"profile_version\":1,"
                        "\"profile_hash\":\"0123456789abcdef0123456789abcdef"
                        "0123456789abcdef0123456789abcdef\","
                        "\"full_depth_mm\":55.5,"
                        "\"pressure_0_kpa_per_count\":0.00000012,"
                        "\"pressure_1_kpa_per_count\":0.00000023,"
                        "\"pressure_2_kpa_per_count\":0.00000034"
                        "}";

  TEST_ASSERT_EQUAL(
      ESP_OK, calibration_manager_parse_start_payload(
                  payload, &config, command_id, sizeof(command_id), &reason));
  TEST_ASSERT_EQUAL(CAL_REASON_NONE, reason);
  TEST_ASSERT_EQUAL_STRING("cal-2", command_id);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 55.5f, config.full_depth_mm);
  TEST_ASSERT_FLOAT_WITHIN(0.00000001f, 0.00000012f,
                           config.pressure_0_kpa_per_count);
  TEST_ASSERT_FLOAT_WITHIN(0.00000001f, 0.00000023f,
                           config.pressure_1_kpa_per_count);
  TEST_ASSERT_FLOAT_WITHIN(0.00000001f, 0.00000034f,
                           config.pressure_2_kpa_per_count);
}

TEST_CASE("Calibration start parser rejects malformed and unsafe values",
          "[calibration]") {
  calibration_config_t config;
  calibration_reason_id_t reason;
  char command_id[32];

  TEST_ASSERT_EQUAL(
      ESP_ERR_INVALID_ARG,
      calibration_manager_parse_start_payload(NULL, &config, command_id,
                                              sizeof(command_id), &reason));
  TEST_ASSERT_EQUAL(CAL_REASON_INVALID_CALIBRATION_PAYLOAD, reason);

  TEST_ASSERT_EQUAL(
      ESP_FAIL, calibration_manager_parse_start_payload(
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
                        "{\"command_id\":\"x\",\"hall_delta\":13500,"
                        "\"ref_pressure\":1,\"bladder_1_pressure\":1,"
                        "\"bladder_2_pressure\":1}",
                        &config, command_id, sizeof(command_id), &reason));
  TEST_ASSERT_EQUAL(CAL_REASON_INVALID_HALL_DELTA, reason);

  TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
                    calibration_manager_parse_start_payload(
                        "{\"command_id\":\"x\",\"hall_delta\":13500,"
                        "\"hall_delta_sample_count\":0,"
                        "\"ref_pressure\":1,\"bladder_1_pressure\":1,"
                        "\"bladder_2_pressure\":1}",
                        &config, command_id, sizeof(command_id), &reason));
  TEST_ASSERT_EQUAL(CAL_REASON_INVALID_HALL_DELTA, reason);

  TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
                    calibration_manager_parse_start_payload(
                        "{\"command_id\":\"x\",\"hall_delta\":90000,"
                        "\"hall_delta_sample_count\":20,"
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

TEST_CASE("Invalid calibration payload preserves caller configuration",
          "[calibration]") {
  calibration_config_t config;
  calibration_config_set_defaults(&config);
  config.calibrated = true;
  config.hall_delta = 777;
  config.ref_pressure = 1234;
  strncpy(config.profile_id, "existing-profile",
          sizeof(config.profile_id) - 1);
  calibration_config_t before = config;
  calibration_reason_id_t reason = CAL_REASON_NONE;
  char command_id[32] = "unchanged";

  TEST_ASSERT_EQUAL(
      ESP_FAIL, calibration_manager_parse_start_payload(
                    "{bad", &config, command_id, sizeof(command_id), &reason));
  TEST_ASSERT_EQUAL_MEMORY(&before, &config, sizeof(config));
  TEST_ASSERT_EQUAL_STRING("", command_id);
}

TEST_CASE(
    "Calibration start parser supports Hall-only without pressure targets",
    "[calibration]") {
  calibration_config_t config;
  calibration_reason_id_t reason;
  char command_id[32];

  TEST_ASSERT_EQUAL(
      ESP_OK,
      calibration_manager_parse_start_payload(
          "{\"request_id\":\"hall-only\",\"pressure_mode\":\"HALL_ONLY\","
          "\"hall_delta\":13500,\"hall_delta_sample_count\":20,"
          "\"profile_id\":\"adult\",\"profile_version\":1,"
          "\"profile_hash\":\"0123456789abcdef0123456789abcdef"
          "0123456789abcdef0123456789abcdef\"}",
          &config, command_id, sizeof(command_id), &reason));
  TEST_ASSERT_EQUAL(CAL_REASON_NONE, reason);
  TEST_ASSERT_EQUAL_STRING("hall-only", command_id);
  TEST_ASSERT_EQUAL(CALIBRATION_HALL_ONLY, config.pressure_mode);
  TEST_ASSERT_EQUAL(675, config.hall_delta);
  TEST_ASSERT_EQUAL(0, config.ref_pressure);
  TEST_ASSERT_EQUAL(0, config.bladder_1_pressure);
  TEST_ASSERT_EQUAL(0, config.bladder_2_pressure);
}

TEST_CASE("Non-Hall calibration policy requires all pressure targets",
          "[calibration][pressure]") {
  calibration_config_t config;
  calibration_reason_id_t reason = CAL_REASON_NONE;
  char command_id[32];

  TEST_ASSERT_EQUAL(
      ESP_ERR_INVALID_ARG,
      calibration_manager_parse_start_payload(
          "{\"request_id\":\"strict-optional\","
          "\"pressure_mode\":\"OPTIONAL\",\"hall_delta\":620,"
          "\"profile_id\":\"adult\"}",
          &config, command_id, sizeof(command_id), &reason));
  TEST_ASSERT_EQUAL(CAL_REASON_INVALID_CALIBRATION_PAYLOAD, reason);
}

TEST_CASE("Calibration start parser rejects unsupported mode and timing",
          "[calibration]") {
  calibration_config_t config;
  calibration_reason_id_t reason;
  char command_id[32];

  TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
                    calibration_manager_parse_start_payload(
                        "{\"request_id\":\"x\",\"pressure_mode\":\"SURPRISE\","
                        "\"hall_delta\":620,\"ref_pressure\":1,"
                        "\"bladder_1_pressure\":1,\"bladder_2_pressure\":1}",
                        &config, command_id, sizeof(command_id), &reason));
  TEST_ASSERT_EQUAL(CAL_REASON_INVALID_CALIBRATION_PAYLOAD, reason);

  TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
                    calibration_manager_parse_start_payload(
                        "{\"request_id\":\"x\",\"pressure_mode\":\"OPTIONAL\","
                        "\"hall_delta\":620,\"ref_pressure\":1,"
                        "\"bladder_1_pressure\":1,\"bladder_2_pressure\":1,"
                        "\"calibration_sample_count\":0}",
                        &config, command_id, sizeof(command_id), &reason));
  TEST_ASSERT_EQUAL(CAL_REASON_INVALID_CALIBRATION_PAYLOAD, reason);
}

TEST_CASE("Calibration degradation never disables physical pressure acquisition",
          "[calibration][pressure]") {
  TEST_ASSERT_TRUE(calibration_manager_pressure_acquisition_enabled(
      CALIBRATION_PRESSURE_REQUIRED));
  TEST_ASSERT_TRUE(calibration_manager_pressure_acquisition_enabled(
      CALIBRATION_PRESSURE_OPTIONAL));
  TEST_ASSERT_TRUE(calibration_manager_pressure_acquisition_enabled(
      CALIBRATION_HALL_WITH_LAST_STABLE_PRESSURE_LEGACY));
  TEST_ASSERT_FALSE(calibration_manager_pressure_acquisition_enabled(
      CALIBRATION_HALL_ONLY));
}

TEST_CASE("Calibration pressure stages validate only requested channels",
          "[calibration][pressure]") {
  TEST_ASSERT_TRUE(calibration_manager_pressure_stage_masks_valid(
      0x07u, 0x06u, 0x01u));
  TEST_ASSERT_TRUE(calibration_manager_pressure_stage_masks_valid(
      0x07u, 0x05u, 0x02u));
  TEST_ASSERT_TRUE(calibration_manager_pressure_stage_masks_valid(
      0x07u, 0x03u, 0x04u));
  TEST_ASSERT_FALSE(calibration_manager_pressure_stage_masks_valid(
      0x07u, 0x04u, 0x07u));
  TEST_ASSERT_FALSE(calibration_manager_pressure_stage_masks_valid(
      0x03u, 0x00u, 0x04u));
}

TEST_CASE("Calibration target windows are strict and overflow safe",
          "[calibration][pressure]") {
  const int32_t target = 3500000;
  const int32_t tolerance =
      calibration_manager_pressure_target_tolerance(target);

  TEST_ASSERT_EQUAL_INT32(280000, tolerance);
  TEST_ASSERT_TRUE(calibration_manager_value_within_target(
      3220000, target, tolerance));
  TEST_ASSERT_TRUE(calibration_manager_value_within_target(
      3780000, target, tolerance));
  TEST_ASSERT_FALSE(calibration_manager_value_within_target(
      3219999, target, tolerance));
  TEST_ASSERT_FALSE(calibration_manager_value_within_target(
      3780001, target, tolerance));
  TEST_ASSERT_FALSE(calibration_manager_value_within_target(
      1286000, target, tolerance));
  TEST_ASSERT_FALSE(calibration_manager_value_within_target(
      4190000, 3100000,
      calibration_manager_pressure_target_tolerance(3100000)));
  TEST_ASSERT_FALSE(calibration_manager_value_within_target(
      3980000, 3100000,
      calibration_manager_pressure_target_tolerance(3100000)));
  TEST_ASSERT_FALSE(
      calibration_manager_value_within_target(target, target, -1));
  TEST_ASSERT_TRUE(calibration_manager_value_within_target(
      INT32_MAX, INT32_MAX, INT32_MAX));
  TEST_ASSERT_TRUE(calibration_manager_value_within_target(
      INT32_MIN, INT32_MIN, INT32_MAX));
}

TEST_CASE("Only fresh primary pressure samples are usable for calibration",
          "[calibration][pressure][pressure_quality]") {
  calibration_pressure_target_sample_t sample = {
      .value = 3100000,
      .read_ok = true,
      .fresh = true,
      .channel_valid = true,
      .timestamp_ms = 1000,
  };

  TEST_ASSERT_TRUE(
      calibration_manager_pressure_target_sample_usable(&sample));
  sample.read_ok = false;
  TEST_ASSERT_FALSE(
      calibration_manager_pressure_target_sample_usable(&sample));
  sample.read_ok = true;
  sample.fresh = false;
  TEST_ASSERT_FALSE(
      calibration_manager_pressure_target_sample_usable(&sample));
  sample.fresh = true;
  sample.channel_valid = false;
  TEST_ASSERT_FALSE(
      calibration_manager_pressure_target_sample_usable(&sample));
  sample.channel_valid = true;
  sample.saturated = true;
  TEST_ASSERT_FALSE(
      calibration_manager_pressure_target_sample_usable(&sample));
  sample.saturated = false;
  sample.stale = true;
  TEST_ASSERT_FALSE(
      calibration_manager_pressure_target_sample_usable(&sample));
  sample.stale = false;
  sample.using_last_stable = true;
  TEST_ASSERT_FALSE(
      calibration_manager_pressure_target_sample_usable(&sample));
}

TEST_CASE("Calibration target hold requires consecutive in-range samples",
          "[calibration][pressure][pressure_quality]") {
  calibration_pressure_target_tracker_t tracker = {0};
  calibration_pressure_target_sample_t sample = {
      .value = 3100000,
      .read_ok = true,
      .fresh = true,
      .channel_valid = true,
      .timestamp_ms = 1000,
  };
  const int32_t tolerance =
      calibration_manager_pressure_target_tolerance(3100000);

  TEST_ASSERT_FALSE(calibration_manager_pressure_target_tracker_observe(
      &tracker, &sample, 3100000, tolerance,
      CALIBRATION_PRESSURE_TARGET_CONSECUTIVE_MATCHES,
      CALIBRATION_PRESSURE_TARGET_HOLD_MS));
  sample.timestamp_ms = 1125;
  TEST_ASSERT_FALSE(calibration_manager_pressure_target_tracker_observe(
      &tracker, &sample, 3100000, tolerance,
      CALIBRATION_PRESSURE_TARGET_CONSECUTIVE_MATCHES,
      CALIBRATION_PRESSURE_TARGET_HOLD_MS));
  sample.timestamp_ms = 1250;
  TEST_ASSERT_TRUE(calibration_manager_pressure_target_tracker_observe(
      &tracker, &sample, 3100000, tolerance,
      CALIBRATION_PRESSURE_TARGET_CONSECUTIVE_MATCHES,
      CALIBRATION_PRESSURE_TARGET_HOLD_MS));

  sample.value = 4000000;
  sample.timestamp_ms = 1300;
  TEST_ASSERT_FALSE(calibration_manager_pressure_target_tracker_observe(
      &tracker, &sample, 3100000, tolerance,
      CALIBRATION_PRESSURE_TARGET_CONSECUTIVE_MATCHES,
      CALIBRATION_PRESSURE_TARGET_HOLD_MS));
  TEST_ASSERT_EQUAL_UINT(0, tracker.consecutive_matches);

  sample.value = 3100000;
  sample.using_last_stable = true;
  sample.timestamp_ms = 1400;
  TEST_ASSERT_FALSE(calibration_manager_pressure_target_tracker_observe(
      &tracker, &sample, 3100000, tolerance,
      CALIBRATION_PRESSURE_TARGET_CONSECUTIVE_MATCHES,
      CALIBRATION_PRESSURE_TARGET_HOLD_MS));
  TEST_ASSERT_EQUAL_UINT(0, tracker.consecutive_matches);
}

TEST_CASE("Calibration terminal result is committed exactly once",
          "[calibration][lifecycle]") {
  calibration_attempt_result_t result = CALIBRATION_ATTEMPT_RUNNING;

  TEST_ASSERT_TRUE(calibration_manager_attempt_result_try_finalize(
      &result, CALIBRATION_ATTEMPT_PASS));
  TEST_ASSERT_EQUAL(CALIBRATION_ATTEMPT_PASS, result);
  TEST_ASSERT_FALSE(calibration_manager_attempt_result_try_finalize(
      &result, CALIBRATION_ATTEMPT_CANCELLED));
  TEST_ASSERT_EQUAL(CALIBRATION_ATTEMPT_PASS, result);

  result = CALIBRATION_ATTEMPT_RUNNING;
  TEST_ASSERT_TRUE(calibration_manager_attempt_result_try_finalize(
      &result, CALIBRATION_ATTEMPT_CANCELLED));
  TEST_ASSERT_FALSE(calibration_manager_attempt_result_try_finalize(
      &result, CALIBRATION_ATTEMPT_FAIL));
  TEST_ASSERT_EQUAL(CALIBRATION_ATTEMPT_CANCELLED, result);
}

TEST_CASE("Only explicit Hall-only policy skips pressure targets",
          "[calibration][pressure]") {
  TEST_ASSERT_TRUE(calibration_manager_pressure_targets_required(
      CALIBRATION_PRESSURE_REQUIRED));
  TEST_ASSERT_TRUE(calibration_manager_pressure_targets_required(
      CALIBRATION_PRESSURE_OPTIONAL));
  TEST_ASSERT_TRUE(calibration_manager_pressure_targets_required(
      CALIBRATION_HALL_WITH_LAST_STABLE_PRESSURE_LEGACY));
  TEST_ASSERT_FALSE(calibration_manager_pressure_targets_required(
      CALIBRATION_HALL_ONLY));
}
