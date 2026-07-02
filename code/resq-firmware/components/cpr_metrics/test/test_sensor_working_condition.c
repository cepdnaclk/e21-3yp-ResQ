#include <string.h>

#include "cpr_metrics.h"
#include "unity.h"

static calibration_config_t sensor_calibration(void)
{
    calibration_config_t config = {
        .hall_baseline = 2000,
        .hall_full_press = 3000,
        .hall_noise_raw = 8,
        .hall_direction = 1,
        .hall_range_raw = 1000,
        .hall_start_delta = 200,
        .hall_full_delta_threshold = 800,
        .hall_recoil_delta = 80,
        .hall_tolerance_raw = 20,
        .pressure_1_baseline = 10000,
        .pressure_2_baseline = 10000,
        .pressure_1_noise_raw = 25,
        .pressure_2_noise_raw = 25,
        .pressure_1_range_raw = 1000,
        .pressure_2_range_raw = 1000,
        .pressure_contact_threshold = 100,
        .pressure_valid_threshold = 500,
        .pressure_balance_allowed_pct = 25,
    };
    return config;
}

static cpr_pressure_window_result_t eval_pressure(const int32_t *p1,
                                                  const int32_t *p2,
                                                  size_t count)
{
    cpr_pressure_window_result_t result;
    calibration_config_t calibration = sensor_calibration();
    TEST_ASSERT_EQUAL(ESP_OK, pressure_sensor_evaluate_window(
                                  p1,
                                  p2,
                                  count,
                                  4,
                                  &calibration,
                                  &result));
    return result;
}

static cpr_hall_window_result_t eval_hall(const int32_t *samples,
                                          size_t count)
{
    cpr_hall_window_result_t result;
    calibration_config_t calibration = sensor_calibration();
    TEST_ASSERT_EQUAL(ESP_OK, hall_sensor_evaluate_window(
                                  samples,
                                  count,
                                  4,
                                  &calibration,
                                  &result));
    return result;
}

TEST_CASE("Pressure sensor resting baseline is stable", "[sensor][pressure]")
{
    const int32_t p1[] = {10000, 10003, 9998, 10002, 10001, 10004};
    const int32_t p2[] = {10005, 10000, 10002, 10003, 10001, 10004};
    cpr_pressure_window_result_t result = eval_pressure(p1, p2, 6);

    TEST_ASSERT_EQUAL(CPR_SENSOR_HEALTH_OK, result.health);
    TEST_ASSERT_TRUE(result.baseline_stable);
    TEST_ASSERT_FALSE(result.response_detected);
    TEST_ASSERT_TRUE(result.release_near_baseline);
    TEST_ASSERT_BITS_LOW(CPR_SENSOR_FAULT_STUCK_ZERO |
                             CPR_SENSOR_FAULT_STUCK_NO_CHANGE |
                             CPR_SENSOR_FAULT_NOISY_BASELINE,
                         result.fault_flags);
}

TEST_CASE("Pressure sensor compression response is detected", "[sensor][pressure]")
{
    const int32_t p1[] = {10000, 10002, 9999, 10001, 10200, 10650, 10820, 10100};
    const int32_t p2[] = {10003, 10000, 10002, 10001, 10180, 10620, 10800, 10090};
    cpr_pressure_window_result_t result = eval_pressure(p1, p2, 8);

    TEST_ASSERT_EQUAL(CPR_SENSOR_HEALTH_OK, result.health);
    TEST_ASSERT_TRUE(result.response_detected);
    TEST_ASSERT_GREATER_OR_EQUAL(500, result.response_delta);
    TEST_ASSERT_TRUE(result.release_near_baseline);
    TEST_ASSERT_TRUE(result.balanced);
}

TEST_CASE("Pressure sensor stuck zero fails health", "[sensor][pressure]")
{
    const int32_t p1[] = {0, 0, 0, 0, 0, 0, 0, 0};
    const int32_t p2[] = {0, 0, 0, 0, 0, 0, 0, 0};
    cpr_pressure_window_result_t result = eval_pressure(p1, p2, 8);

    TEST_ASSERT_EQUAL(CPR_SENSOR_HEALTH_FAIL, result.health);
    TEST_ASSERT_BITS(CPR_SENSOR_FAULT_STUCK_ZERO, CPR_SENSOR_FAULT_STUCK_ZERO, result.fault_flags);
}

TEST_CASE("Pressure sensor saturated reading fails health", "[sensor][pressure]")
{
    const int32_t p1[] = {0x7FFFFF, 0x7FFFFF, 0x7FFFFF, 0x7FFFFF};
    const int32_t p2[] = {0x7FFFFF, 0x7FFFFF, 0x7FFFFF, 0x7FFFFF};
    cpr_pressure_window_result_t result = eval_pressure(p1, p2, 4);

    TEST_ASSERT_EQUAL(CPR_SENSOR_HEALTH_FAIL, result.health);
    TEST_ASSERT_BITS(CPR_SENSOR_FAULT_SATURATED, CPR_SENSOR_FAULT_SATURATED, result.fault_flags);
}

TEST_CASE("Pressure sensor no-change window fails health", "[sensor][pressure]")
{
    const int32_t p1[] = {10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000};
    const int32_t p2[] = {10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000};
    cpr_pressure_window_result_t result = eval_pressure(p1, p2, 8);

    TEST_ASSERT_EQUAL(CPR_SENSOR_HEALTH_FAIL, result.health);
    TEST_ASSERT_BITS(CPR_SENSOR_FAULT_STUCK_NO_CHANGE,
                     CPR_SENSOR_FAULT_STUCK_NO_CHANGE,
                     result.fault_flags);
}

TEST_CASE("Pressure sensor noise fails baseline check", "[sensor][pressure]")
{
    const int32_t p1[] = {10000, 10120, 9890, 10080, 10020, 10030};
    const int32_t p2[] = {10000, 10090, 9880, 10110, 10000, 10010};
    cpr_pressure_window_result_t result = eval_pressure(p1, p2, 6);

    TEST_ASSERT_EQUAL(CPR_SENSOR_HEALTH_FAIL, result.health);
    TEST_ASSERT_FALSE(result.baseline_stable);
    TEST_ASSERT_BITS(CPR_SENSOR_FAULT_NOISY_BASELINE,
                     CPR_SENSOR_FAULT_NOISY_BASELINE,
                     result.fault_flags);
}

TEST_CASE("Pressure sensor balance classifies centered and off-center compression", "[sensor][pressure]")
{
    const int32_t centered_p1[] = {10000, 10002, 10001, 9999, 10600, 10800, 10080};
    const int32_t centered_p2[] = {10000, 9999, 10002, 10001, 10590, 10790, 10070};
    cpr_pressure_window_result_t centered = eval_pressure(centered_p1, centered_p2, 7);
    TEST_ASSERT_TRUE(centered.balanced);
    TEST_ASSERT_LESS_OR_EQUAL(25, centered.imbalance_pct);

    const int32_t left_p1[] = {10000, 10002, 10001, 9999, 11000, 11200, 10080};
    const int32_t left_p2[] = {10000, 9999, 10002, 10001, 10180, 10200, 10070};
    cpr_pressure_window_result_t left = eval_pressure(left_p1, left_p2, 7);
    TEST_ASSERT_FALSE(left.balanced);
    TEST_ASSERT_GREATER_THAN(25, left.imbalance_pct);
    TEST_ASSERT_BITS(CPR_SENSOR_FAULT_IMBALANCED,
                     CPR_SENSOR_FAULT_IMBALANCED,
                     left.fault_flags);
}

TEST_CASE("Hall sensor resting baseline is stable", "[sensor][hall]")
{
    const int32_t hall[] = {2000, 2002, 1999, 2001, 2000, 2003};
    cpr_hall_window_result_t result = eval_hall(hall, 6);

    TEST_ASSERT_EQUAL(CPR_SENSOR_HEALTH_OK, result.health);
    TEST_ASSERT_TRUE(result.baseline_stable);
    TEST_ASSERT_FALSE(result.movement_detected);
    TEST_ASSERT_TRUE(result.recoil_detected);
    TEST_ASSERT_INT_WITHIN(2, 2000, result.baseline);
}

TEST_CASE("Hall sensor compression delta is detected", "[sensor][hall]")
{
    const int32_t hall[] = {2000, 2002, 1999, 2001, 2200, 2600, 2825, 2010};
    cpr_hall_window_result_t result = eval_hall(hall, 8);

    TEST_ASSERT_EQUAL(CPR_SENSOR_HEALTH_OK, result.health);
    TEST_ASSERT_TRUE(result.movement_detected);
    TEST_ASSERT_TRUE(result.full_depth_detected);
    TEST_ASSERT_FLOAT_WITHIN(0.02f, 0.825f, result.depth_progress);
    TEST_ASSERT_TRUE(result.recoil_detected);
}

TEST_CASE("Hall sensor incomplete recoil is detected", "[sensor][hall]")
{
    const int32_t hall[] = {2000, 2001, 1999, 2000, 2300, 2850, 2550, 2400};
    cpr_hall_window_result_t result = eval_hall(hall, 8);

    TEST_ASSERT_TRUE(result.movement_detected);
    TEST_ASSERT_TRUE(result.full_depth_detected);
    TEST_ASSERT_FALSE(result.recoil_detected);
    TEST_ASSERT_BITS(CPR_SENSOR_FAULT_RELEASE_NOT_NEAR_BASELINE,
                     CPR_SENSOR_FAULT_RELEASE_NOT_NEAR_BASELINE,
                     result.fault_flags);
}

TEST_CASE("Hall sensor invalid range and no-change fail health", "[sensor][hall]")
{
    const int32_t stuck_zero[] = {0, 0, 0, 0, 0, 0, 0, 0};
    const int32_t saturated[] = {4095, 4095, 4095, 4095};
    const int32_t no_change[] = {2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000};

    cpr_hall_window_result_t zero = eval_hall(stuck_zero, 8);
    TEST_ASSERT_EQUAL(CPR_SENSOR_HEALTH_FAIL, zero.health);
    TEST_ASSERT_BITS(CPR_SENSOR_FAULT_STUCK_ZERO, CPR_SENSOR_FAULT_STUCK_ZERO, zero.fault_flags);

    cpr_hall_window_result_t sat = eval_hall(saturated, 4);
    TEST_ASSERT_EQUAL(CPR_SENSOR_HEALTH_FAIL, sat.health);
    TEST_ASSERT_BITS(CPR_SENSOR_FAULT_SATURATED, CPR_SENSOR_FAULT_SATURATED, sat.fault_flags);

    cpr_hall_window_result_t stuck = eval_hall(no_change, 8);
    TEST_ASSERT_EQUAL(CPR_SENSOR_HEALTH_FAIL, stuck.health);
    TEST_ASSERT_BITS(CPR_SENSOR_FAULT_STUCK_NO_CHANGE,
                     CPR_SENSOR_FAULT_STUCK_NO_CHANGE,
                     stuck.fault_flags);
}

TEST_CASE("Hall sensor reset math uses baseline not zero", "[sensor][hall]")
{
    TEST_ASSERT_EQUAL(40, hall_sensor_compute_delta(2040, 2000, 1));
    TEST_ASSERT_EQUAL(40, hall_sensor_compute_delta(1960, 2000, -1));
    TEST_ASSERT_NOT_EQUAL(2040, hall_sensor_compute_delta(2040, 2000, 1));
}

TEST_CASE("Readiness passes only when pressure and Hall are OK", "[sensor][readiness]")
{
    const int32_t p1_ok[] = {10000, 10003, 9998, 10002, 10001, 10004};
    const int32_t p2_ok[] = {10005, 10000, 10002, 10003, 10001, 10004};
    const int32_t hall_ok[] = {2000, 2002, 1999, 2001, 2000, 2003};
    const int32_t p_bad[] = {0, 0, 0, 0, 0, 0, 0, 0};
    const int32_t hall_bad[] = {4095, 4095, 4095, 4095};
    cpr_sensor_readiness_result_t readiness;

    cpr_pressure_window_result_t pressure = eval_pressure(p1_ok, p2_ok, 6);
    cpr_hall_window_result_t hall = eval_hall(hall_ok, 6);
    TEST_ASSERT_EQUAL(ESP_OK, sensor_readiness_evaluate(&pressure, &hall, &readiness));
    TEST_ASSERT_EQUAL(CPR_READINESS_READY_FOR_SESSION, readiness.readiness);
    TEST_ASSERT_TRUE(readiness.pressure_ok);
    TEST_ASSERT_TRUE(readiness.hall_ok);

    cpr_pressure_window_result_t pressure_fail = eval_pressure(p_bad, p_bad, 8);
    TEST_ASSERT_EQUAL(ESP_OK, sensor_readiness_evaluate(&pressure_fail, &hall, &readiness));
    TEST_ASSERT_EQUAL(CPR_READINESS_NOT_READY, readiness.readiness);
    TEST_ASSERT_FALSE(readiness.pressure_ok);
    TEST_ASSERT_TRUE(readiness.hall_ok);
    TEST_ASSERT_BITS(CPR_SENSOR_FAULT_STUCK_ZERO,
                     CPR_SENSOR_FAULT_STUCK_ZERO,
                     readiness.pressure_fault_flags);

    cpr_hall_window_result_t hall_fail = eval_hall(hall_bad, 4);
    TEST_ASSERT_EQUAL(ESP_OK, sensor_readiness_evaluate(&pressure, &hall_fail, &readiness));
    TEST_ASSERT_EQUAL(CPR_READINESS_NOT_READY, readiness.readiness);
    TEST_ASSERT_TRUE(readiness.pressure_ok);
    TEST_ASSERT_FALSE(readiness.hall_ok);

    TEST_ASSERT_EQUAL(ESP_OK, sensor_readiness_evaluate(&pressure_fail, &hall_fail, &readiness));
    TEST_ASSERT_EQUAL(CPR_READINESS_NOT_READY, readiness.readiness);
    TEST_ASSERT_FALSE(readiness.pressure_ok);
    TEST_ASSERT_FALSE(readiness.hall_ok);
    TEST_ASSERT_NOT_EQUAL(0, readiness.pressure_fault_flags);
    TEST_ASSERT_NOT_EQUAL(0, readiness.hall_fault_flags);
}

TEST_CASE("Readiness warning is not confused with pass", "[sensor][readiness]")
{
    cpr_pressure_window_result_t pressure = {
        .health = CPR_SENSOR_HEALTH_OK,
        .fault_flags = CPR_SENSOR_FAULT_IMBALANCED,
    };
    cpr_hall_window_result_t hall = {
        .health = CPR_SENSOR_HEALTH_OK,
        .fault_flags = CPR_SENSOR_FAULT_NONE,
    };
    cpr_sensor_readiness_result_t readiness;

    TEST_ASSERT_EQUAL(ESP_OK, sensor_readiness_evaluate(&pressure, &hall, &readiness));
    TEST_ASSERT_EQUAL(CPR_READINESS_WARNING, readiness.readiness);
    TEST_ASSERT_EQUAL(CPR_SENSOR_HEALTH_WARNING, readiness.health);
    TEST_ASSERT_NOT_EQUAL(CPR_READINESS_READY_FOR_SESSION, readiness.readiness);
}
