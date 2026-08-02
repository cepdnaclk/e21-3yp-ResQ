#include <math.h>
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
        .full_depth_mm = 50.0f,
        .pressure_0_baseline = 1000,
        .pressure_1_baseline = 1000,
        .pressure_2_baseline = 1000,
        .pressure_0_kpa_per_count = 0.01f,
        .pressure_1_kpa_per_count = 0.01f,
        .pressure_2_kpa_per_count = 0.01f,
        .pressure_1_range_raw = 1000,
        .pressure_2_range_raw = 1000,
        .pressure_saturation_hall_delta = 700,
        .bladder_1_full_press = 2000,
        .bladder_2_full_press = 2000,
        .pressure_contact_threshold = 100,
        .pressure_valid_threshold = 500,
        .pressure_balance_allowed_pct = 20,
        .pressure_mode = CALIBRATION_PRESSURE_OPTIONAL,
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

static void update_with_quality(int32_t hall,
                                int32_t p1,
                                int32_t p2,
                                int64_t ts,
                                uint32_t quality_flags)
{
    cpr_sensor_sample_t sample = {
        .hall_raw = hall,
        .pressure_1_raw = p1,
        .pressure_2_raw = p2,
        .ts_ms = ts,
        .quality_flags = quality_flags,
    };
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_update(&sample));
}

static void update_with_pressure_metadata(int32_t hall,
                                          int32_t p1,
                                          int32_t p2,
                                          int64_t ts,
                                          uint32_t sequence,
                                          bool fresh,
                                          uint8_t valid_mask)
{
    cpr_sensor_sample_t sample = {
        .hall_raw = hall,
        .pressure_1_raw = p1,
        .pressure_2_raw = p2,
        .ts_ms = ts,
        .pressure_timestamp_ms = ts,
        .pressure_sequence = sequence,
        .pressure_frame_fresh = fresh,
        .pressure_acquisition_active = true,
        .pressure_valid_mask = valid_mask,
    };
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_update(&sample));
}

static void start_with_stable_pressure(int32_t hall,
                                       int32_t p1,
                                       int32_t p2,
                                       int64_t ts)
{
    update(hall, p1, p2, ts);
    update(hall, p1, p2, ts + 1);
    update(hall, p1, p2, ts + 2);
}

static void complete_compression_for_recoil(bool recoil_ok, int64_t ts)
{
    update(1400, 1600, 1600, ts);
    update(1900, 1700, 1700, ts + 100);
    update(1200, 1200, 1200, ts + 200);
    if (recoil_ok) {
        update(1000, 1000, 1000, ts + 300);
        update(1000, 1000, 1000, ts + 360);
    } else {
        update(1400, 1600, 1600, ts + 300);
    }
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

TEST_CASE("CPR metric normalization derives flags from authoritative values",
          "[metrics][contract]")
{
    cpr_metrics_snapshot_t snapshot = {
        .depth_ok = false,
        .recoil_ok = false,
        .last_compression_incomplete_recoil = true,
        .rate_cpm = 108.0f,
        .pause_s = CPR_PAUSE_CONDITION_THRESHOLD_S + 0.1f,
        .pressure_balance_pct = 93.5f,
        .pressure_balance_reliable = true,
        .pressure_mode = CALIBRATION_PRESSURE_OPTIONAL,
    };
    strcpy(snapshot.hand_placement, "LEFT");
    strcpy(snapshot.flags, "DEPTH_OK,RECOIL_OK");

    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
                      cpr_metrics_normalize_snapshot(NULL));
    TEST_ASSERT_EQUAL(ESP_OK,
                      cpr_metrics_normalize_snapshot(&snapshot));
    TEST_ASSERT_EQUAL_STRING("CENTER", snapshot.hand_placement);
    TEST_ASSERT_NOT_NULL(strstr(snapshot.flags, "RATE_OK"));
    TEST_ASSERT_NOT_NULL(strstr(snapshot.flags, "INCOMPLETE_RECOIL"));
    TEST_ASSERT_NOT_NULL(strstr(snapshot.flags, "PAUSE_DETECTED"));
    TEST_ASSERT_NULL(strstr(snapshot.flags, "DEPTH_OK"));
    TEST_ASSERT_NULL(strstr(snapshot.flags, "RECOIL_OK"));
    TEST_ASSERT_NULL(strstr(snapshot.flags, "HAND_LEFT"));
}

TEST_CASE("CPR pressure centeredness uses the shared 88 percent threshold",
          "[metrics][contract]")
{
    cpr_metrics_snapshot_t snapshot = {
        .pressure_balance_pct =
            CPR_PRESSURE_CENTER_SCORE_THRESHOLD_PCT - 0.1f,
        .pressure_balance_reliable = true,
        .pressure_mode = CALIBRATION_PRESSURE_OPTIONAL,
    };
    strcpy(snapshot.hand_placement, "CENTER");

    TEST_ASSERT_EQUAL(ESP_OK,
                      cpr_metrics_normalize_snapshot(&snapshot));
    TEST_ASSERT_EQUAL_STRING("SKEWED", snapshot.hand_placement);
    TEST_ASSERT_NOT_NULL(strstr(snapshot.flags, "HAND_SKEWED"));

    snapshot.pressure_balance_pct =
        CPR_PRESSURE_CENTER_SCORE_THRESHOLD_PCT;
    TEST_ASSERT_EQUAL(ESP_OK,
                      cpr_metrics_normalize_snapshot(&snapshot));
    TEST_ASSERT_EQUAL_STRING("CENTER", snapshot.hand_placement);
    TEST_ASSERT_NULL(strstr(snapshot.flags, "HAND_SKEWED"));
}

TEST_CASE("CPR metrics tracks valid compression recoil depth and rate", "[metrics]")
{
    calibration_config_t calibration = metrics_calibration();
    cpr_metrics_snapshot_t snapshot;
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_init());
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_reset(&calibration));

    update(1400, 1500, 1500, 1000);
    update(1600, 1600, 1600, 1040);
    update(1900, 1700, 1700, 1100);
    update(1200, 1200, 1200, 1200);
    update(1000, 1000, 1000, 1300);
    update(1000, 1000, 1000, 1360);
    start_with_stable_pressure(1400, 1600, 1600, 1500);

    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_EQUAL(2, snapshot.total_compressions);
    TEST_ASSERT_EQUAL(1, snapshot.valid_compressions);
    TEST_ASSERT_EQUAL(1, snapshot.recoil_ok_count);
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 120.0f, snapshot.rate_cpm);
    TEST_ASSERT_EQUAL_STRING("CENTER", snapshot.hand_placement);
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 100.0f, snapshot.pressure_balance_pct);
}

TEST_CASE("CPR metrics classifies contact imbalance without clipping depth",
          "[metrics]")
{
    calibration_config_t calibration = metrics_calibration();
    cpr_metrics_snapshot_t snapshot;
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_init());
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_reset(&calibration));

    start_with_stable_pressure(2500, 2000, 1100, 1000);
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 1.0f, snapshot.depth_progress);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 75.0f, snapshot.depth_mm);
    TEST_ASSERT_NOT_EQUAL(0, strcmp("CENTER", snapshot.hand_placement));
    TEST_ASSERT_TRUE(snapshot.pressure_balance_pct < 50.0f);

    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_reset(&calibration));
    start_with_stable_pressure(1400, 1050, 1050, 1100);
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_EQUAL_STRING("UNKNOWN", snapshot.hand_placement);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.0f, snapshot.pressure_balance_pct);
    TEST_ASSERT_FALSE(snapshot.hand_placement_locked);
    TEST_ASSERT_EQUAL_UINT8(0x06, snapshot.pressure_below_contact_mask);
}

TEST_CASE("CPR metrics normalizes pressure channels by calibrated range", "[metrics]")
{
    calibration_config_t calibration = metrics_calibration();
    calibration.pressure_1_range_raw = 1000;
    calibration.pressure_2_range_raw = 500;
    cpr_metrics_snapshot_t snapshot;

    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_init());
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_reset(&calibration));

    start_with_stable_pressure(1400, 1600, 1300, 1000);
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_EQUAL_STRING("CENTER", snapshot.hand_placement);
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 100.0f, snapshot.pressure_balance_pct);
}

TEST_CASE("CPR metrics uses calibrated Hall tail after pressure crossover", "[metrics]")
{
    calibration_config_t calibration = metrics_calibration();
    cpr_metrics_snapshot_t snapshot;

    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_init());
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_reset(&calibration));

    start_with_stable_pressure(1400, 1600, 1600, 1000);
    update(1900, 8400001, 8400001, 1100);

    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.9f, snapshot.depth_progress);
    TEST_ASSERT_FALSE(snapshot.pressure_balance_reliable);
    TEST_ASSERT_EQUAL(0x06, snapshot.pressure_saturation_mask);
    TEST_ASSERT_FALSE((snapshot.sensor_quality_flags & CPR_SENSOR_QUALITY_PRESSURE_SATURATED) != 0);
    TEST_ASSERT_TRUE((snapshot.sensor_quality_flags & CPR_SENSOR_QUALITY_PRESSURE_CROSSOVER) != 0);
    TEST_ASSERT_TRUE((snapshot.sensor_quality_flags & CPR_SENSOR_QUALITY_PRESSURE_BALANCE_HELD) != 0);
    TEST_ASSERT_TRUE(snapshot.hand_placement_locked);
    TEST_ASSERT_TRUE(snapshot.pressure_became_unusable);
    TEST_ASSERT_EQUAL(CPR_PRESSURE_LOCK_CALIBRATED_CROSSOVER,
                      snapshot.pressure_lock_reason);
    TEST_ASSERT_TRUE(snapshot.pressure_evidence_sufficient);
    TEST_ASSERT_TRUE(snapshot.pressure_last_stable_available);
    TEST_ASSERT_TRUE(snapshot.pressure_last_accepted_available);
    TEST_ASSERT_EQUAL_STRING("CENTER", snapshot.hand_placement);
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 100.0f, snapshot.pressure_balance_pct);
    TEST_ASSERT_EQUAL(1, snapshot.valid_compressions);
    TEST_ASSERT_NULL(strstr(snapshot.flags, "PRESSURE_SATURATED"));
    TEST_ASSERT_NOT_NULL(strstr(snapshot.flags, "PRESSURE_CROSSOVER"));
    TEST_ASSERT_NOT_NULL(strstr(snapshot.flags, "PRESSURE_BALANCE_HELD"));
}

TEST_CASE("CPR metrics exposes pressure kPa validity per channel", "[metrics]")
{
    calibration_config_t calibration = metrics_calibration();
    cpr_metrics_snapshot_t snapshot;
    cpr_sensor_sample_t sample = {
        .hall_raw = 1400,
        .pressure_0_raw = 1100,
        .pressure_1_raw = 1200,
        .pressure_2_raw = 8300000,
        .ts_ms = 1000,
    };

    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_init());
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_reset(&calibration));
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_update(&sample));
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));

    TEST_ASSERT_TRUE(snapshot.pressure_0_kpa_valid);
    TEST_ASSERT_TRUE(snapshot.pressure_1_kpa_valid);
    TEST_ASSERT_FALSE(snapshot.pressure_2_kpa_valid);
    TEST_ASSERT_FALSE(snapshot.pressure_kpa_valid);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 1.0f, snapshot.pressure_0_kpa);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 2.0f, snapshot.pressure_1_kpa);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.0f, snapshot.pressure_2_kpa);
}

TEST_CASE("CPR metrics pressure balance reliability follows balance channels", "[metrics]")
{
    calibration_config_t calibration = metrics_calibration();
    cpr_metrics_snapshot_t snapshot;
    cpr_sensor_sample_t sample = {
        .hall_raw = 1400,
        .pressure_0_raw = 8300000,
        .pressure_1_raw = 1600,
        .pressure_2_raw = 1600,
        .ts_ms = 1000,
    };

    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_init());
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_reset(&calibration));
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_update(&sample));
    sample.ts_ms++;
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_update(&sample));
    sample.ts_ms++;
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_update(&sample));
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));

    TEST_ASSERT_FALSE(snapshot.pressure_0_kpa_valid);
    TEST_ASSERT_TRUE(snapshot.pressure_1_kpa_valid);
    TEST_ASSERT_TRUE(snapshot.pressure_2_kpa_valid);
    TEST_ASSERT_FALSE(snapshot.pressure_kpa_valid);
    TEST_ASSERT_TRUE(snapshot.pressure_balance_reliable);
    TEST_ASSERT_EQUAL(0x01, snapshot.pressure_saturation_mask);
}

TEST_CASE("CPR metrics holds depth and state on missed Hall sample", "[metrics]")
{
    calibration_config_t calibration = metrics_calibration();
    cpr_metrics_snapshot_t snapshot;

    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_init());
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_reset(&calibration));

    update(1400, 1600, 1600, 1000);
    update_with_quality(0, 1700, 1700, 1100, CPR_SAMPLE_HALL_READ_FAILED);

    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.4f, snapshot.depth_progress);
    TEST_ASSERT_EQUAL(1, snapshot.total_compressions);
    TEST_ASSERT_EQUAL(1, snapshot.missed_hall_samples);
    TEST_ASSERT_TRUE((snapshot.sensor_quality_flags & CPR_SENSOR_QUALITY_HALL_MISSED) != 0);
    TEST_ASSERT_NOT_NULL(strstr(snapshot.flags, "HALL_MISSED"));
}

TEST_CASE("CPR metrics preserves pressure evidence across temporary invalid reads",
          "[metrics]")
{
    calibration_config_t calibration = metrics_calibration();
    cpr_metrics_snapshot_t snapshot;
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_init());
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_reset(&calibration));

    start_with_stable_pressure(1400, 1600, 1600, 1000);
    update_with_quality(1400, 0, 0, 1401,
                        CPR_SAMPLE_PRESSURE_READ_FAILED);

    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_EQUAL_STRING("CENTER", snapshot.hand_placement);
    TEST_ASSERT_TRUE((snapshot.sensor_quality_flags &
                      CPR_SENSOR_QUALITY_PRESSURE_BALANCE_HELD) != 0);
    TEST_ASSERT_TRUE(snapshot.pressure_last_stable_available);
    TEST_ASSERT_TRUE(snapshot.pressure_using_last_stable);
    TEST_ASSERT_EQUAL_UINT32(3, snapshot.accepted_pressure_samples);
    TEST_ASSERT_EQUAL_UINT8(0, snapshot.pressure_current_valid_mask);
    TEST_ASSERT_EQUAL_UINT8(0x06, snapshot.pressure_invalid_mask);
    TEST_ASSERT_FALSE((snapshot.sensor_quality_flags &
                       CPR_SENSOR_QUALITY_PRESSURE_STALE) != 0);
}

TEST_CASE("CPR metrics reports unavailable placement without early evidence",
          "[metrics]")
{
    calibration_config_t calibration = metrics_calibration();
    cpr_metrics_snapshot_t snapshot;
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_init());
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_reset(&calibration));

    update(1400, 8400001, 8400001, 1000);
    update(1900, 8400001, 8400001, 1100);

    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_EQUAL_STRING("UNAVAILABLE", snapshot.hand_placement);
    TEST_ASSERT_TRUE(snapshot.hand_placement_locked);
    TEST_ASSERT_FALSE(snapshot.pressure_last_stable_available);
    TEST_ASSERT_FALSE(snapshot.pressure_evidence_sufficient);
    TEST_ASSERT_TRUE((snapshot.sensor_quality_flags &
                      CPR_SENSOR_QUALITY_HAND_PLACEMENT_UNAVAILABLE) != 0);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.9f, snapshot.depth_progress);
}

TEST_CASE("pressure saturation before calibrated crossover remains a fault",
          "[metrics][pressure]")
{
    calibration_config_t calibration = metrics_calibration();
    cpr_metrics_snapshot_t snapshot;
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_init());
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_reset(&calibration));

    update(1400, 1600, 1600, 1000);
    update(1600, 8400001, 8400001, 1020);

    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_EQUAL(CPR_PRESSURE_LOCK_SATURATION,
                      snapshot.pressure_lock_reason);
    TEST_ASSERT_TRUE((snapshot.sensor_quality_flags &
                      CPR_SENSOR_QUALITY_PRESSURE_SATURATED) != 0);
    TEST_ASSERT_FALSE((snapshot.sensor_quality_flags &
                       CPR_SENSOR_QUALITY_PRESSURE_CROSSOVER) != 0);
}

TEST_CASE("pressure must recover after calibrated saturation crossover",
          "[metrics][pressure]")
{
    calibration_config_t calibration = metrics_calibration();
    cpr_metrics_snapshot_t snapshot;
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_init());
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_reset(&calibration));

    start_with_stable_pressure(1400, 1600, 1600, 1000);
    update(1900, 8400001, 8400001, 1100);
    update(1200, 1200, 1200, 1200);

    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_FALSE((snapshot.sensor_quality_flags &
                       CPR_SENSOR_QUALITY_PRESSURE_SATURATED) != 0);
    TEST_ASSERT_FALSE((snapshot.sensor_quality_flags &
                       CPR_SENSOR_QUALITY_PRESSURE_CROSSOVER) != 0);

    update(1000, 8400001, 8400001, 1300);
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_TRUE((snapshot.sensor_quality_flags &
                      CPR_SENSOR_QUALITY_PRESSURE_SATURATED) != 0);
    TEST_ASSERT_FALSE((snapshot.sensor_quality_flags &
                       CPR_SENSOR_QUALITY_PRESSURE_CROSSOVER) != 0);
}

TEST_CASE("CPR metrics distinguishes out of range from saturation",
          "[metrics]")
{
    calibration_config_t calibration = metrics_calibration();
    calibration.pressure_saturation_hall_delta = 0;
    cpr_metrics_snapshot_t snapshot;
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_init());
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_reset(&calibration));

    start_with_stable_pressure(1400, 1600, 1600, 1000);
    update(1700, 2100, 2100, 1100);

    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_EQUAL_UINT8(0, snapshot.pressure_saturation_mask);
    TEST_ASSERT_EQUAL_UINT8(0x06, snapshot.pressure_out_of_range_mask);
    TEST_ASSERT_EQUAL_UINT8(0x06, snapshot.pressure_upper_limit_mask);
    TEST_ASSERT_TRUE(snapshot.hand_placement_locked);
    TEST_ASSERT_EQUAL(CPR_PRESSURE_LOCK_UPPER_LIMIT,
                      snapshot.pressure_lock_reason);
    TEST_ASSERT_TRUE((snapshot.sensor_quality_flags &
                      CPR_SENSOR_QUALITY_PRESSURE_OUT_OF_RANGE) != 0);
    TEST_ASSERT_FALSE((snapshot.sensor_quality_flags &
                       CPR_SENSOR_QUALITY_PRESSURE_SATURATED) != 0);
    TEST_ASSERT_NOT_NULL(strstr(snapshot.flags, "PRESSURE_OUT_OF_RANGE"));
}

TEST_CASE("CPR metrics resets pressure lock for next compression", "[metrics]")
{
    calibration_config_t calibration = metrics_calibration();
    cpr_metrics_snapshot_t snapshot;
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_init());
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_reset(&calibration));

    start_with_stable_pressure(1400, 1600, 1600, 1000);
    update(1900, 8400001, 8400001, 1100);
    update(1200, 1200, 1200, 1200);
    update(1000, 1000, 1000, 1300);
    update(1000, 1000, 1000, 1360);
    update(1400, 1600, 1600, 1500);

    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_FALSE(snapshot.hand_placement_locked);
    TEST_ASSERT_FALSE(snapshot.pressure_became_unusable);
    TEST_ASSERT_EQUAL(2, snapshot.total_compressions);
    TEST_ASSERT_EQUAL_UINT32(1, snapshot.accepted_pressure_samples);
}

TEST_CASE("CPR session accepts rising magnitude with stable distribution",
          "[metrics]")
{
    calibration_config_t calibration = metrics_calibration();
    cpr_metrics_snapshot_t snapshot;
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_init());
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_reset(&calibration));

    update(1400, 1300, 1300, 1000);
    update(1500, 1600, 1600, 1020);
    update(1600, 1900, 1900, 1040);

    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_EQUAL_UINT32(3, snapshot.accepted_pressure_samples);
    TEST_ASSERT_TRUE(snapshot.pressure_evidence_sufficient);
    TEST_ASSERT_TRUE(snapshot.pressure_balance_reliable);
    TEST_ASSERT_EQUAL_UINT8(0x06,
                            snapshot.pressure_decision_usable_mask);
    TEST_ASSERT_EQUAL_STRING("CENTER", snapshot.hand_placement);
}

TEST_CASE("CPR session requires consistent distribution and enough frames",
          "[metrics]")
{
    calibration_config_t calibration = metrics_calibration();
    cpr_metrics_snapshot_t snapshot;
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_init());
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_reset(&calibration));

    update(1400, 1600, 1600, 1000);
    update(1500, 1900, 1200, 1020);
    update(1600, 1200, 1900, 1040);

    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_EQUAL_UINT32(3, snapshot.accepted_pressure_samples);
    TEST_ASSERT_FALSE(snapshot.pressure_evidence_sufficient);
    TEST_ASSERT_FALSE(snapshot.pressure_balance_reliable);
    TEST_ASSERT_EQUAL_STRING("UNKNOWN", snapshot.hand_placement);
}

TEST_CASE("CPR session ignores low and reverse contact without locking",
          "[metrics]")
{
    calibration_config_t calibration = metrics_calibration();
    cpr_metrics_snapshot_t snapshot;
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_init());
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_reset(&calibration));

    update(1400, 1050, 1050, 1000);
    update(1500, 900, 900, 1020);

    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_EQUAL_UINT32(0, snapshot.accepted_pressure_samples);
    TEST_ASSERT_FALSE(snapshot.hand_placement_locked);
    TEST_ASSERT_EQUAL(CPR_PRESSURE_LOCK_NONE,
                      snapshot.pressure_lock_reason);
    TEST_ASSERT_EQUAL_UINT8(0, snapshot.pressure_upper_limit_mask);
}

TEST_CASE("upper limit before minimum evidence locks unavailable",
          "[metrics]")
{
    calibration_config_t calibration = metrics_calibration();
    calibration.pressure_saturation_hall_delta = 0;
    cpr_metrics_snapshot_t snapshot;
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_init());
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_reset(&calibration));

    update(1400, 1600, 1600, 1000);
    update(1500, 1700, 1700, 1020);
    update(1600, 2100, 2100, 1040);

    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_EQUAL_UINT32(2, snapshot.accepted_pressure_samples);
    TEST_ASSERT_FALSE(snapshot.pressure_evidence_sufficient);
    TEST_ASSERT_TRUE(snapshot.hand_placement_locked);
    TEST_ASSERT_EQUAL_STRING("UNAVAILABLE", snapshot.hand_placement);
}

TEST_CASE("stale pressure preserves evidence and is not consumed",
          "[metrics]")
{
    calibration_config_t calibration = metrics_calibration();
    cpr_metrics_snapshot_t snapshot;
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_init());
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_reset(&calibration));

    update_with_pressure_metadata(1400, 1400, 1400, 1000, 1, true, 0x07);
    update_with_pressure_metadata(1500, 1600, 1600, 1020, 2, true, 0x07);
    update_with_pressure_metadata(1600, 1800, 1800, 1040, 3, true, 0x07);
    update_with_pressure_metadata(1700, 0, 0, 1060, 3, false, 0x07);

    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_EQUAL_UINT32(3, snapshot.accepted_pressure_samples);
    TEST_ASSERT_TRUE(snapshot.pressure_last_accepted_available);
    TEST_ASSERT_TRUE(snapshot.pressure_evidence_sufficient);
    TEST_ASSERT_FALSE(snapshot.pressure_frame_fresh);
    TEST_ASSERT_EQUAL_UINT8(0x06, snapshot.pressure_invalid_mask);
    TEST_ASSERT_NOT_NULL(strstr(snapshot.flags, "PRESSURE_STALE"));
}

TEST_CASE("locked pressure result ignores later valid frames",
          "[metrics]")
{
    calibration_config_t calibration = metrics_calibration();
    cpr_metrics_snapshot_t snapshot;
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_init());
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_reset(&calibration));

    start_with_stable_pressure(1400, 1600, 1600, 1000);
    update(1600, 8400001, 8400001, 1040);
    update(1700, 1900, 1100, 1060);

    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_TRUE(snapshot.hand_placement_locked);
    TEST_ASSERT_EQUAL_STRING("CENTER", snapshot.hand_placement);
    TEST_ASSERT_EQUAL_UINT32(3, snapshot.accepted_pressure_samples);
    TEST_ASSERT_TRUE(snapshot.pressure_acquisition_active);
    TEST_ASSERT_EQUAL_UINT8(0x07,
                            snapshot.pressure_current_valid_mask);
}

TEST_CASE("recompression completes prior compression as incomplete recoil",
          "[metrics][recoil]")
{
    calibration_config_t calibration = metrics_calibration();
    cpr_metrics_snapshot_t snapshot;
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_init());
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_reset(&calibration));

    start_with_stable_pressure(1400, 1600, 1600, 1000);
    update(1900, 1700, 1700, 1100);
    update(1200, 1500, 1500, 1200);
    update(1400, 1600, 1600, 1300);

    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_EQUAL(2, snapshot.total_compressions);
    TEST_ASSERT_EQUAL(1, snapshot.completed_compressions);
    TEST_ASSERT_EQUAL(1, snapshot.incomplete_recoil_count);
    TEST_ASSERT_FALSE(snapshot.last_compression_recoil_ok);
    TEST_ASSERT_TRUE(snapshot.last_compression_incomplete_recoil);
    TEST_ASSERT_NOT_NULL(strstr(snapshot.flags, "INCOMPLETE_RECOIL"));
    TEST_ASSERT_FALSE(snapshot.pressure_evidence_sufficient);
    TEST_ASSERT_FALSE(snapshot.hand_placement_locked);
}

TEST_CASE("completed compression depth averages one peak from each event",
           "[metrics][depth]")
{
    calibration_config_t calibration = metrics_calibration();
    cpr_metrics_snapshot_t snapshot;
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_init());
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_reset(&calibration));

    update(1400, 1600, 1600, 1000);
    update(2200, 1700, 1700, 1100);
    update(1200, 1200, 1200, 1200);
    update(1000, 1000, 1000, 1300);
    update(1000, 1000, 1000, 1360);

    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_EQUAL(1, snapshot.completed_compressions);
    TEST_ASSERT_EQUAL(1, snapshot.depth_ok_compressions);
    TEST_ASSERT_FLOAT_WITHIN(
        0.01f, 60.0f, snapshot.last_compression_peak_depth_mm);
    TEST_ASSERT_FLOAT_WITHIN(
        0.01f, 60.0f,
        snapshot.average_completed_compression_peak_depth_mm);

    update(1400, 1600, 1600, 1500);
    update(1800, 1700, 1700, 1600);
    update(1000, 1000, 1000, 1700);
    update(1000, 1000, 1000, 1760);
    update(1000, 1000, 1000, 1820);

    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_EQUAL(2, snapshot.completed_compressions);
    TEST_ASSERT_FLOAT_WITHIN(
        0.01f, 40.0f, snapshot.last_compression_peak_depth_mm);
    TEST_ASSERT_FLOAT_WITHIN(
        0.01f, 50.0f,
        snapshot.average_completed_compression_peak_depth_mm);

    /* Idle/recoil frames cannot complete or score the same event twice. */
    update(1000, 1000, 1000, 1900);
    update(1050, 1000, 1000, 2000);
    update(1000, 1000, 1000, 2100);
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_EQUAL(2, snapshot.total_compressions);
    TEST_ASSERT_EQUAL(2, snapshot.completed_compressions);
    TEST_ASSERT_EQUAL(2, snapshot.recoil_ok_count);
    TEST_ASSERT_EQUAL(0, snapshot.incomplete_recoil_count);
    TEST_ASSERT_FLOAT_WITHIN(
        0.01f, 50.0f,
        snapshot.average_completed_compression_peak_depth_mm);
}

TEST_CASE("compression rate responds to the newest rhythm interval",
          "[metrics][rate]")
{
    calibration_config_t calibration = metrics_calibration();
    cpr_metrics_snapshot_t snapshot;
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_init());
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_reset(&calibration));

    update(1400, 1600, 1600, 1000);
    update(1900, 1700, 1700, 1100);
    update(1000, 1000, 1000, 1300);
    update(1000, 1000, 1000, 1360);

    update(1400, 1600, 1600, 1500);
    update(1900, 1700, 1700, 1600);
    update(1000, 1000, 1000, 1800);
    update(1000, 1000, 1000, 1860);

    update(1400, 1600, 1600, 2500);

    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_FLOAT_WITHIN(0.2f, 81.0f, snapshot.rate_cpm);
}

TEST_CASE("CPR metrics invalidates stale rate and tracks release pause",
          "[metrics]")
{
    calibration_config_t calibration = metrics_calibration();
    cpr_metrics_snapshot_t snapshot;
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_init());
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_reset(&calibration));

    start_with_stable_pressure(1400, 1600, 1600, 1000);
    update(1900, 1700, 1700, 1100);
    update(1200, 1200, 1200, 1200);
    update(1000, 1000, 1000, 1300);
    update(1000, 1000, 1000, 1360);
    start_with_stable_pressure(1400, 1600, 1600, 1500);
    update(1900, 1700, 1700, 1600);
    update(1200, 1200, 1200, 1700);
    update(1000, 1000, 1000, 1800);
    update(1000, 1000, 1000, 1860);
    update(1000, 1000, 1000, 5001);

    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.0f, snapshot.rate_cpm);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 3.141f, snapshot.pause_s);
    TEST_ASSERT_TRUE(snapshot.last_compression_depth_ok);
    TEST_ASSERT_TRUE(snapshot.last_compression_recoil_ok);
    TEST_ASSERT_FALSE(snapshot.last_compression_incomplete_recoil);
    TEST_ASSERT_FALSE(snapshot.current_depth_in_range);
    TEST_ASSERT_TRUE(snapshot.depth_ok);
}

TEST_CASE("live depth uses newest reading while scored depth keeps five-reading EMA",
          "[metrics][window][ema][depth]")
{
    calibration_config_t calibration = metrics_calibration();
    cpr_metrics_snapshot_t snapshot;
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_init());
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_reset(&calibration));

    update(1800, 1000, 1000, 1000);
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_TRUE(snapshot.depth_mm_valid);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 40.0f, snapshot.depth_mm);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 40.0f, snapshot.depth_mm_scored);

    update(1840, 1000, 1000, 1100);
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 41.70f, snapshot.depth_mm);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 40.60f, snapshot.depth_mm_scored);

    update(1900, 1000, 1000, 1200);
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 44.505f, snapshot.depth_mm);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 41.64f, snapshot.depth_mm_scored);

    update(1960, 1000, 1000, 1300);
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 47.47575f, snapshot.depth_mm);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 42.906f, snapshot.depth_mm_scored);

    update(2000, 1000, 1000, 1400);
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 49.62136f, snapshot.depth_mm);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 44.1624f, snapshot.depth_mm_scored);

    update(2100, 1000, 1000, 1500);
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 54.1932f, snapshot.depth_mm);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 46.46496f, snapshot.depth_mm_scored);

    update_with_quality(1000, 1000, 1000, 1600,
                        CPR_SAMPLE_HALL_READ_FAILED);
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 54.1932f, snapshot.depth_mm);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 46.46496f, snapshot.depth_mm_scored);

    update(2200, 1000, 1000, 1500);
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 54.1932f, snapshot.depth_mm);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 46.46496f, snapshot.depth_mm_scored);

    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_clear_live_filters());
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_FALSE(snapshot.depth_mm_valid);
    TEST_ASSERT_FALSE(snapshot.recoil_pct_valid);
    TEST_ASSERT_FALSE(snapshot.depth_mm_scored_valid);
    TEST_ASSERT_TRUE(isfinite(snapshot.depth_mm));
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.0f, snapshot.depth_mm);

    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_reset(&calibration));
    update(2000, 1000, 1000, 2000);
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 50.0f, snapshot.depth_mm);
}

TEST_CASE("live recoil EMA is independent from depth and preserves classifications",
          "[metrics][window][ema][recoil]")
{
    calibration_config_t calibration = metrics_calibration();
    cpr_metrics_snapshot_t snapshot;
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_init());
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_reset(&calibration));

    update(1400, 1600, 1600, 1000);
    update(1900, 1700, 1700, 1100);
    update(1200, 1200, 1200, 1200);
    update(1000, 1000, 1000, 1300);
    update(1000, 1000, 1000, 1360);
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_TRUE(snapshot.recoil_pct_valid);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 100.0f, snapshot.recoil_pct);
    float depth_before = snapshot.depth_mm;

    update(1400, 1600, 1600, 1500);
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_EQUAL(1, snapshot.completed_compressions);
    TEST_ASSERT_EQUAL(1, snapshot.recoil_ok_count);
    TEST_ASSERT_EQUAL(0, snapshot.incomplete_recoil_count);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 100.0f, snapshot.recoil_pct);
    TEST_ASSERT_TRUE(fabsf(depth_before - snapshot.depth_mm) > 0.01f);

    update(1900, 1700, 1700, 1600);
    update(1200, 1500, 1500, 1700);
    update(1400, 1600, 1600, 1800);
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_EQUAL(2, snapshot.completed_compressions);
    TEST_ASSERT_EQUAL(1, snapshot.recoil_ok_count);
    TEST_ASSERT_EQUAL(1, snapshot.incomplete_recoil_count);
    TEST_ASSERT_FALSE(snapshot.last_compression_recoil_ok);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 15.0f, snapshot.recoil_pct);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 70.0f, snapshot.recoil_pct_scored);
    TEST_ASSERT_TRUE(isfinite(snapshot.recoil_pct));
}

TEST_CASE("live recoil window evicts the oldest of five completed events",
          "[metrics][window][ema][recoil]")
{
    calibration_config_t calibration = metrics_calibration();
    cpr_metrics_snapshot_t snapshot;
    const bool outcomes[] = {true, false, true, false, true, false};
    const float expected[] = {
        100.0f, 70.0f, 68.0f, 57.2f, 58.88f, 47.552f
    };

    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_init());
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_reset(&calibration));

    for (size_t i = 0; i < sizeof(outcomes) / sizeof(outcomes[0]); ++i) {
        complete_compression_for_recoil(outcomes[i],
                                        1000 + (int64_t)i * 500);
        TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
        TEST_ASSERT_TRUE(snapshot.recoil_pct_valid);
        TEST_ASSERT_FLOAT_WITHIN(0.02f, expected[i], snapshot.recoil_pct_scored);
        TEST_ASSERT_TRUE(isfinite(snapshot.recoil_pct));
    }

    TEST_ASSERT_EQUAL(6, snapshot.completed_compressions);
    TEST_ASSERT_EQUAL(3, snapshot.recoil_ok_count);
    TEST_ASSERT_EQUAL(3, snapshot.incomplete_recoil_count);

    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_clear_live_filters());
    TEST_ASSERT_EQUAL(ESP_OK, cpr_metrics_get_snapshot(&snapshot));
    TEST_ASSERT_FALSE(snapshot.recoil_pct_valid);
    TEST_ASSERT_EQUAL(6, snapshot.completed_compressions);
    TEST_ASSERT_EQUAL(3, snapshot.recoil_ok_count);
    TEST_ASSERT_EQUAL(3, snapshot.incomplete_recoil_count);
}
