#include "cpr_metrics.h"

#include <limits.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>

#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "sensor_conversion.h"

static const char *TAG = "cpr_metrics";

static int32_t calib_abs_i32(int32_t v)
{
    int64_t wide = v;
    if (wide < 0) wide = -wide;
    return wide > INT32_MAX ? INT32_MAX : (int32_t)wide;
}

static int32_t calib_abs_diff_i32(int32_t a, int32_t b)
{
    int64_t diff = (int64_t)a - (int64_t)b;
    if (diff < 0) diff = -diff;
    return diff > INT32_MAX ? INT32_MAX : (int32_t)diff;
}

static int32_t calib_max_i32(int32_t a, int32_t b)
{
    return a >= b ? a : b;
}

static int32_t calib_min_i32(int32_t a, int32_t b)
{
    return a <= b ? a : b;
}

static bool pressure_raw_is_saturated(int32_t value)
{
    return sensor_conversion_pressure_raw_is_saturated(value);
}

static int32_t average_i32(const int32_t *samples, size_t count)
{
    int64_t sum = 0;
    for (size_t i = 0; i < count; i++) {
        sum += samples[i];
    }
    return (int32_t)(sum / (int64_t)count);
}

static int32_t peak_to_peak_i32(const int32_t *samples, size_t count)
{
    int32_t min_value = samples[0];
    int32_t max_value = samples[0];

    for (size_t i = 1; i < count; i++) {
        min_value = calib_min_i32(min_value, samples[i]);
        max_value = calib_max_i32(max_value, samples[i]);
    }

    return calib_abs_diff_i32(max_value, min_value);
}

static bool all_samples_equal(const int32_t *samples, size_t count)
{
    for (size_t i = 1; i < count; i++) {
        if (samples[i] != samples[0]) {
            return false;
        }
    }

    return true;
}

static cpr_sensor_health_t health_from_faults(uint32_t faults)
{
    const uint32_t fail_faults =
        CPR_SENSOR_FAULT_TOO_FEW_SAMPLES |
        CPR_SENSOR_FAULT_STUCK_ZERO |
        CPR_SENSOR_FAULT_SATURATED |
        CPR_SENSOR_FAULT_STUCK_NO_CHANGE |
        CPR_SENSOR_FAULT_NOISY_BASELINE |
        CPR_SENSOR_FAULT_INVALID_RANGE;

    return (faults & fail_faults) ? CPR_SENSOR_HEALTH_FAIL : CPR_SENSOR_HEALTH_OK;
}

/* thresholds are adaptive and derived from calibration_config_t at runtime */

#define CPR_HALL_ADC_MAX_RAW 4095

#define CPR_SENSOR_1_SIDE_LABEL "LEFT"
#define CPR_SENSOR_2_SIDE_LABEL "RIGHT"
#define CPR_PRESSURE_BALANCE_SENSOR_MASK 0x06u
#define CPR_RATE_STALE_MS 3000
#define CPR_HAND_PLACEMENT_MIN_ACCEPTED_FRAMES 3u
#define CPR_HAND_PLACEMENT_DISTRIBUTION_WINDOW 3u
#define CPR_RELEASE_CONFIRMATION_MS 60

typedef enum {
    WAITING_FOR_COMPRESSION = 0,
    COMPRESSING,
    FULL_PRESS_REACHED,
    RELEASING
} cpr_state_t;

static calibration_config_t s_calib;
static SemaphoreHandle_t s_mutex = NULL;

/* runtime counters */
static cpr_state_t s_state = WAITING_FOR_COMPRESSION;
static int s_total_compressions = 0;
static int s_valid_compressions = 0;
static int s_recoil_ok_count = 0;
static int s_incomplete_recoil_count = 0;
static float s_rate_cpm = 0.0f;
static int64_t s_last_compression_start_ms = 0;
static int64_t s_current_compression_start_ms = 0;
static int64_t s_last_compression_end_ms = 0;
static float s_last_pause_s = 0.0f;
static bool s_current_compression_depth_ok = false;
static bool s_last_compression_depth_ok = false;
static bool s_last_compression_recoil_ok = false;
static bool s_last_compression_incomplete_recoil = false;
static float s_depth_progress = 0.0f;
static float s_depth_mm = 0.0f;
static float s_pressure_0_kpa = 0.0f;
static float s_pressure_1_kpa = 0.0f;
static float s_pressure_2_kpa = 0.0f;
static bool s_pressure_0_kpa_valid = false;
static bool s_pressure_1_kpa_valid = false;
static bool s_pressure_2_kpa_valid = false;
static bool s_pressure_kpa_valid = false;
static bool s_hall_mm_valid = false;
static float s_pressure_balance_pct = 0.0f;
static int64_t s_last_sample_ms = 0;
static char s_hand_placement[CPR_HAND_PLACEMENT_MAX_LEN] = "NO_CONTACT";
static float s_prev_progress = 0.0f;
static char s_last_reliable_hand_placement[CPR_HAND_PLACEMENT_MAX_LEN] = "NO_CONTACT";
static float s_last_reliable_pressure_balance_pct = 0.0f;
static int64_t s_last_reliable_pressure_ms = 0;
static bool s_has_reliable_pressure_balance = false;
static bool s_pressure_balance_reliable = false;
static uint8_t s_pressure_saturation_mask = 0;
static uint8_t s_pressure_out_of_range_mask = 0;
static uint8_t s_pressure_upper_limit_mask = 0;
static uint8_t s_pressure_below_contact_mask = 0;
static uint8_t s_pressure_current_valid_mask = 0;
static uint8_t s_pressure_invalid_mask = 0;
static uint8_t s_pressure_stable_mask = 0;
static uint8_t s_pressure_decision_usable_mask = 0;
static bool s_pressure_acquisition_active = false;
static bool s_pressure_frame_fresh = false;
static bool s_pressure_temporarily_degraded = false;
static uint32_t s_sensor_quality_flags = 0;
static int s_missed_pressure_samples = 0;
static int s_missed_hall_samples = 0;
static int64_t s_release_candidate_since_ms = 0;

typedef struct {
    bool compression_active;
    bool pressure_evidence_available;
    bool evidence_sufficient;
    bool hand_placement_locked;
    bool pressure_became_unusable;
    cpr_pressure_lock_reason_t lock_reason;
    unsigned accepted_pressure_samples;
    int32_t last_accepted_raw[3];
    int64_t last_accepted_timestamp_ms;
    bool has_last_accepted;
    int64_t accumulated_pressure[3];
    unsigned accumulated_count;
    int32_t peak_total_contact;
    int32_t last_distribution_q15;
    int32_t distribution_window[CPR_HAND_PLACEMENT_DISTRIBUTION_WINDOW];
    size_t distribution_count;
    size_t distribution_write_index;
    char locked_hand_placement[CPR_HAND_PLACEMENT_MAX_LEN];
    float locked_pressure_balance_pct;
} compression_pressure_context_t;

static compression_pressure_context_t s_compression_pressure;

static int32_t pressure_contact_delta(int32_t raw,
                                      int32_t baseline,
                                      int32_t full_press)
{
    int32_t direction =
        full_press != 0 && full_press < baseline ? -1 : 1;
    int64_t delta = ((int64_t)raw - baseline) * direction;
    if (delta <= 0) {
        return 0;
    }
    return delta > INT32_MAX ? INT32_MAX : (int32_t)delta;
}

static int32_t pressure_reliable_contact_limit(int32_t baseline,
                                               int32_t full_press,
                                               int32_t range_raw)
{
    if (full_press != 0 && full_press != baseline) {
        return calib_abs_diff_i32(full_press, baseline);
    }
    return range_raw > 0 ? range_raw : 1;
}

static int32_t pressure_distribution_q15(int32_t contact_1,
                                         int32_t contact_2)
{
    int64_t normalized_1 =
        s_calib.pressure_1_range_raw > 0
            ? ((int64_t)contact_1 << 15) /
                  s_calib.pressure_1_range_raw
            : contact_1;
    int64_t normalized_2 =
        s_calib.pressure_2_range_raw > 0
            ? ((int64_t)contact_2 << 15) /
                  s_calib.pressure_2_range_raw
            : contact_2;
    int64_t total = normalized_1 + normalized_2;
    if (total <= 0) {
        return 0;
    }
    int64_t ratio =
        ((normalized_1 - normalized_2) << 15) / total;
    if (ratio > INT32_MAX) return INT32_MAX;
    if (ratio < INT32_MIN) return INT32_MIN;
    return (int32_t)ratio;
}

static bool compression_distribution_push(int32_t distribution_q15)
{
    size_t index = s_compression_pressure.distribution_write_index;
    s_compression_pressure.distribution_window[index] = distribution_q15;
    s_compression_pressure.distribution_write_index =
        (index + 1u) % CPR_HAND_PLACEMENT_DISTRIBUTION_WINDOW;
    if (s_compression_pressure.distribution_count <
        CPR_HAND_PLACEMENT_DISTRIBUTION_WINDOW) {
        s_compression_pressure.distribution_count++;
    }
    if (s_compression_pressure.distribution_count <
        CPR_HAND_PLACEMENT_DISTRIBUTION_WINDOW) {
        return false;
    }

    int32_t minimum = s_compression_pressure.distribution_window[0];
    int32_t maximum = minimum;
    for (size_t i = 1;
         i < CPR_HAND_PLACEMENT_DISTRIBUTION_WINDOW;
         ++i) {
        minimum = calib_min_i32(
            minimum, s_compression_pressure.distribution_window[i]);
        maximum = calib_max_i32(
            maximum, s_compression_pressure.distribution_window[i]);
    }
    int32_t allowed_pct =
        s_calib.pressure_balance_allowed_pct > 0
            ? s_calib.pressure_balance_allowed_pct
            : 25;
    int32_t max_spread_q15 =
        (int32_t)(((int64_t)allowed_pct * 32768) / 100);
    return calib_abs_diff_i32(maximum, minimum) <= max_spread_q15;
}

static void compression_pressure_start(void)
{
    memset(&s_compression_pressure, 0, sizeof(s_compression_pressure));
    s_compression_pressure.compression_active = true;
    strncpy(s_compression_pressure.locked_hand_placement, "UNAVAILABLE",
            sizeof(s_compression_pressure.locked_hand_placement) - 1);
    s_pressure_stable_mask = 0;
    s_pressure_decision_usable_mask = 0;
    s_pressure_saturation_mask = 0;
    s_pressure_out_of_range_mask = 0;
    s_pressure_upper_limit_mask = 0;
    s_pressure_below_contact_mask = 0;
    s_has_reliable_pressure_balance = false;
    s_pressure_balance_reliable = false;
    s_pressure_balance_pct = 0.0f;
    strncpy(s_hand_placement, "UNKNOWN", sizeof(s_hand_placement) - 1);
    s_hand_placement[sizeof(s_hand_placement) - 1] = '\0';
    ESP_LOGI(TAG, "SESSION_COMPRESSION_PRESSURE_RESET compression=%d",
             s_total_compressions + 1);
}

static void compression_pressure_end(void)
{
    s_compression_pressure.compression_active = false;
    if (!s_compression_pressure.pressure_evidence_available) {
        strncpy(s_hand_placement, "UNAVAILABLE",
                sizeof(s_hand_placement) - 1);
        s_hand_placement[sizeof(s_hand_placement) - 1] = '\0';
        s_sensor_quality_flags |=
            CPR_SENSOR_QUALITY_HAND_PLACEMENT_UNAVAILABLE;
    }
}

static bool compression_release_confirmed(int32_t hall_delta,
                                          int64_t now_ms)
{
    if (hall_delta > s_calib.hall_recoil_delta) {
        s_release_candidate_since_ms = 0;
        return false;
    }
    if (s_release_candidate_since_ms == 0) {
        s_release_candidate_since_ms = now_ms;
        return false;
    }
    return now_ms - s_release_candidate_since_ms >=
           CPR_RELEASE_CONFIRMATION_MS;
}

static void compression_pressure_lock(cpr_pressure_lock_reason_t reason)
{
    if (s_compression_pressure.hand_placement_locked) {
        return;
    }

    s_compression_pressure.hand_placement_locked = true;
    s_compression_pressure.pressure_became_unusable = true;
    s_compression_pressure.lock_reason = reason;
    if (s_compression_pressure.evidence_sufficient) {
        strncpy(s_compression_pressure.locked_hand_placement,
                s_hand_placement,
                sizeof(s_compression_pressure.locked_hand_placement) - 1);
        s_compression_pressure
            .locked_hand_placement
                [sizeof(s_compression_pressure.locked_hand_placement) - 1] =
            '\0';
        s_compression_pressure.locked_pressure_balance_pct =
            s_pressure_balance_pct;
        s_sensor_quality_flags |= CPR_SENSOR_QUALITY_PRESSURE_BALANCE_HELD;
    } else {
        strncpy(s_compression_pressure.locked_hand_placement, "UNAVAILABLE",
                sizeof(s_compression_pressure.locked_hand_placement) - 1);
        strncpy(s_hand_placement, "UNAVAILABLE",
                sizeof(s_hand_placement) - 1);
        s_hand_placement[sizeof(s_hand_placement) - 1] = '\0';
        s_pressure_balance_pct = 0.0f;
        s_sensor_quality_flags |=
            CPR_SENSOR_QUALITY_HAND_PLACEMENT_UNAVAILABLE;
        ESP_LOGI(
            TAG,
            "SESSION_HAND_PLACEMENT_UNAVAILABLE compression=%d "
            "reason=%s_BEFORE_SUFFICIENT_EVIDENCE",
            s_total_compressions,
            cpr_pressure_lock_reason_to_string(reason));
    }

    ESP_LOGI(TAG,
             "SESSION_HAND_PLACEMENT_LOCKED compression=%d evidence=%u "
             "result=%s reason=%s",
             s_total_compressions,
             s_compression_pressure.accepted_pressure_samples,
             s_compression_pressure.locked_hand_placement,
             cpr_pressure_lock_reason_to_string(reason));
}

static void compression_pressure_update_decision(void)
{
    if (s_compression_pressure.accumulated_count == 0) {
        return;
    }

    int32_t average_1 = (int32_t)(
        s_compression_pressure.accumulated_pressure[1] /
        (int64_t)s_compression_pressure.accumulated_count);
    int32_t average_2 = (int32_t)(
        s_compression_pressure.accumulated_pressure[2] /
        (int64_t)s_compression_pressure.accumulated_count);
    int32_t p1_delta = average_1;
    int32_t p2_delta = average_2;

    int32_t imbalance_pct = pressure_sensor_compute_balance_pct(
        p1_delta, p2_delta,
        s_calib.pressure_1_range_raw,
        s_calib.pressure_2_range_raw);
    int64_t p1_normalized =
        s_calib.pressure_1_range_raw > 0
            ? ((int64_t)p1_delta * 1000) / s_calib.pressure_1_range_raw
            : p1_delta;
    int64_t p2_normalized =
        s_calib.pressure_2_range_raw > 0
            ? ((int64_t)p2_delta * 1000) / s_calib.pressure_2_range_raw
            : p2_delta;

    s_pressure_balance_pct = (float)(100 - imbalance_pct);
    if (imbalance_pct <= s_calib.pressure_balance_allowed_pct) {
        strncpy(s_hand_placement, "CENTER", sizeof(s_hand_placement) - 1);
    } else if (p1_normalized > p2_normalized) {
        strncpy(s_hand_placement, CPR_SENSOR_1_SIDE_LABEL,
                sizeof(s_hand_placement) - 1);
    } else {
        strncpy(s_hand_placement, CPR_SENSOR_2_SIDE_LABEL,
                sizeof(s_hand_placement) - 1);
    }
    s_hand_placement[sizeof(s_hand_placement) - 1] = '\0';

    s_compression_pressure.pressure_evidence_available =
        s_compression_pressure.evidence_sufficient;
    strncpy(s_last_reliable_hand_placement, s_hand_placement,
            sizeof(s_last_reliable_hand_placement) - 1);
    s_last_reliable_hand_placement[
        sizeof(s_last_reliable_hand_placement) - 1] = '\0';
    s_last_reliable_pressure_balance_pct = s_pressure_balance_pct;
    s_last_reliable_pressure_ms =
        s_compression_pressure.last_accepted_timestamp_ms;
    s_has_reliable_pressure_balance = true;
}

esp_err_t cpr_metrics_init(void)
{
    if (s_mutex == NULL) {
        s_mutex = xSemaphoreCreateMutex();
        if (s_mutex == NULL) {
            return ESP_ERR_NO_MEM;
        }
    }

    memset(&s_calib, 0, sizeof(s_calib));
    s_state = WAITING_FOR_COMPRESSION;
    s_total_compressions = 0;
    s_valid_compressions = 0;
    s_recoil_ok_count = 0;
    s_incomplete_recoil_count = 0;
    s_rate_cpm = 0.0f;
    s_last_compression_start_ms = 0;
    s_current_compression_start_ms = 0;
    s_last_compression_end_ms = 0;
    s_last_pause_s = 0.0f;
    s_current_compression_depth_ok = false;
    s_last_compression_depth_ok = false;
    s_last_compression_recoil_ok = false;
    s_last_compression_incomplete_recoil = false;
    s_depth_progress = 0.0f;
    s_depth_mm = 0.0f;
    s_pressure_0_kpa = 0.0f;
    s_pressure_1_kpa = 0.0f;
    s_pressure_2_kpa = 0.0f;
    s_pressure_0_kpa_valid = false;
    s_pressure_1_kpa_valid = false;
    s_pressure_2_kpa_valid = false;
    s_pressure_kpa_valid = false;
    s_hall_mm_valid = false;
    s_pressure_balance_pct = 0.0f;
    s_last_sample_ms = 0;
    s_prev_progress = 0.0f;
    strncpy(s_hand_placement, "NO_CONTACT", sizeof(s_hand_placement) - 1);
    strncpy(s_last_reliable_hand_placement, "NO_CONTACT", sizeof(s_last_reliable_hand_placement) - 1);
    s_last_reliable_pressure_balance_pct = 0.0f;
    s_last_reliable_pressure_ms = 0;
    s_has_reliable_pressure_balance = false;
    s_pressure_balance_reliable = false;
    s_pressure_saturation_mask = 0;
    s_pressure_out_of_range_mask = 0;
    s_pressure_upper_limit_mask = 0;
    s_pressure_below_contact_mask = 0;
    s_pressure_current_valid_mask = 0;
    s_pressure_invalid_mask = CPR_PRESSURE_BALANCE_SENSOR_MASK;
    s_pressure_stable_mask = 0;
    s_pressure_decision_usable_mask = 0;
    s_pressure_acquisition_active = false;
    s_pressure_frame_fresh = false;
    s_pressure_temporarily_degraded = false;
    s_sensor_quality_flags = 0;
    s_missed_pressure_samples = 0;
    s_missed_hall_samples = 0;
    s_release_candidate_since_ms = 0;
    memset(&s_compression_pressure, 0, sizeof(s_compression_pressure));

    return ESP_OK;
}

esp_err_t cpr_metrics_reset(const calibration_config_t *calibration)
{
    if (calibration == NULL) return ESP_ERR_INVALID_ARG;

    if (s_mutex == NULL) return ESP_ERR_INVALID_STATE;
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(200)) != pdTRUE) return ESP_ERR_TIMEOUT;

    memcpy(&s_calib, calibration, sizeof(s_calib));

    s_state = WAITING_FOR_COMPRESSION;
    s_total_compressions = 0;
    s_valid_compressions = 0;
    s_recoil_ok_count = 0;
    s_incomplete_recoil_count = 0;
    s_rate_cpm = 0.0f;
    s_last_compression_start_ms = 0;
    s_current_compression_start_ms = 0;
    s_last_compression_end_ms = 0;
    s_last_pause_s = 0.0f;
    s_current_compression_depth_ok = false;
    s_last_compression_depth_ok = false;
    s_last_compression_recoil_ok = false;
    s_last_compression_incomplete_recoil = false;
    s_depth_progress = 0.0f;
    s_depth_mm = 0.0f;
    s_pressure_0_kpa = 0.0f;
    s_pressure_1_kpa = 0.0f;
    s_pressure_2_kpa = 0.0f;
    s_pressure_0_kpa_valid = false;
    s_pressure_1_kpa_valid = false;
    s_pressure_2_kpa_valid = false;
    s_pressure_kpa_valid = false;
    s_hall_mm_valid = false;
    s_pressure_balance_pct = 0.0f;
    s_last_sample_ms = 0;
    s_prev_progress = 0.0f;
    strncpy(s_hand_placement, "NO_CONTACT", sizeof(s_hand_placement) - 1);
    strncpy(s_last_reliable_hand_placement, "NO_CONTACT", sizeof(s_last_reliable_hand_placement) - 1);
    s_last_reliable_pressure_balance_pct = 0.0f;
    s_last_reliable_pressure_ms = 0;
    s_has_reliable_pressure_balance = false;
    s_pressure_balance_reliable = false;
    s_pressure_saturation_mask = 0;
    s_pressure_out_of_range_mask = 0;
    s_pressure_upper_limit_mask = 0;
    s_pressure_below_contact_mask = 0;
    s_pressure_current_valid_mask = 0;
    s_pressure_invalid_mask = CPR_PRESSURE_BALANCE_SENSOR_MASK;
    s_pressure_stable_mask = 0;
    s_pressure_decision_usable_mask = 0;
    s_pressure_acquisition_active = false;
    s_pressure_frame_fresh = false;
    s_pressure_temporarily_degraded = false;
    s_sensor_quality_flags = 0;
    s_missed_pressure_samples = 0;
    s_missed_hall_samples = 0;
    s_release_candidate_since_ms = 0;
    memset(&s_compression_pressure, 0, sizeof(s_compression_pressure));

    xSemaphoreGive(s_mutex);

    return ESP_OK;
}

static float clampf(float v, float lo, float hi)
{
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
}

static bool pressure_is_saturated(int32_t value)
{
    return sensor_conversion_pressure_raw_is_saturated(value);
}

static bool calibration_uses_hall_only_pressure(void)
{
    return s_calib.pressure_mode == CALIBRATION_HALL_ONLY ||
           s_calib.pressure_mode == CALIBRATION_HALL_WITH_LAST_STABLE_PRESSURE ||
           s_calib.pressure_degraded ||
           !s_calib.pressure_valid;
}

static uint8_t pressure_saturation_mask(const cpr_sensor_sample_t *sample)
{
    uint8_t mask = 0;
    if (pressure_is_saturated(sample->pressure_0_raw)) mask |= 0x01u;
    if (pressure_is_saturated(sample->pressure_1_raw)) mask |= 0x02u;
    if (pressure_is_saturated(sample->pressure_2_raw)) mask |= 0x04u;
    return mask;
}

static sensor_conversion_profile_t conversion_profile_from_calibration(
    const calibration_config_t *calibration)
{
    sensor_conversion_profile_t profile = {
        .pressure_baseline_raw = {
            calibration->pressure_0_baseline,
            calibration->pressure_1_baseline,
            calibration->pressure_2_baseline,
        },
        .pressure_baseline_valid = {
            calibration->pressure_0_baseline != 0,
            calibration->pressure_1_baseline != 0,
            calibration->pressure_2_baseline != 0,
        },
        .pressure_kpa_per_count = {
            calibration->pressure_0_kpa_per_count,
            calibration->pressure_1_kpa_per_count,
            calibration->pressure_2_kpa_per_count,
        },
        .hall_baseline_raw = calibration->hall_baseline,
        .hall_baseline_valid = calibration->hall_baseline > 0,
        .hall_range_raw = calibration->hall_range_raw,
        .hall_direction = (int8_t)calibration->hall_direction,
        .full_depth_mm = calibration->full_depth_mm,
        .required_pressure_mask = SENSOR_CONVERSION_PRESSURE_DEFAULT_REQUIRED_MASK,
    };
    return profile;
}

static void append_snapshot_flag(char *flags, size_t flags_len, size_t *pos, const char *flag)
{
    if (flags == NULL || pos == NULL || flag == NULL || *pos >= flags_len) {
        return;
    }

    int written = snprintf(flags + *pos, flags_len - *pos, "%s", flag);
    if (written <= 0) {
        return;
    }

    if ((size_t)written >= flags_len - *pos) {
        *pos = flags_len - 1;
    } else {
        *pos += (size_t)written;
    }
}

esp_err_t cpr_metrics_update(const cpr_sensor_sample_t *sample)
{
    if (sample == NULL) return ESP_ERR_INVALID_ARG;
    if (s_mutex == NULL) return ESP_ERR_INVALID_STATE;

    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(200)) != pdTRUE) return ESP_ERR_TIMEOUT;

    s_last_sample_ms = sample->ts_ms;

    bool hall_valid = (sample->quality_flags & CPR_SAMPLE_HALL_READ_FAILED) == 0;
    const uint32_t pressure_failure_flags =
        CPR_SAMPLE_PRESSURE_READ_FAILED |
        CPR_SAMPLE_PRESSURE_0_READ_FAILED |
        CPR_SAMPLE_PRESSURE_1_READ_FAILED |
        CPR_SAMPLE_PRESSURE_2_READ_FAILED;
    bool pressure_snapshot_metadata_present =
        sample->pressure_sequence != 0 ||
        sample->pressure_timestamp_ms != 0 ||
        sample->pressure_acquisition_active ||
        sample->pressure_frame_fresh ||
        sample->pressure_valid_mask != 0;
    bool pressure_failure_reported =
        (sample->quality_flags & pressure_failure_flags) != 0;
    bool pressure_metadata_present =
        pressure_snapshot_metadata_present || pressure_failure_reported;
    uint8_t pressure_read_valid_mask =
        pressure_snapshot_metadata_present
            ? sample->pressure_valid_mask
            : (sample->quality_flags & CPR_SAMPLE_PRESSURE_READ_FAILED) != 0
                  ? 0
            : (uint8_t)(
                  ((sample->quality_flags &
                    CPR_SAMPLE_PRESSURE_0_READ_FAILED) == 0
                       ? 0x01u
                       : 0u) |
                  ((sample->quality_flags &
                    CPR_SAMPLE_PRESSURE_1_READ_FAILED) == 0
                       ? 0x02u
                       : 0u) |
                  ((sample->quality_flags &
                    CPR_SAMPLE_PRESSURE_2_READ_FAILED) == 0
                       ? 0x04u
                       : 0u));
    bool pressure_frame_fresh =
        pressure_snapshot_metadata_present
            ? sample->pressure_frame_fresh
            : !pressure_failure_reported;
    if (!pressure_frame_fresh) {
        pressure_read_valid_mask = 0;
    }
    bool pressure_0_valid = (pressure_read_valid_mask & 0x01u) != 0;
    bool pressure_1_valid = (pressure_read_valid_mask & 0x02u) != 0;
    bool pressure_2_valid = (pressure_read_valid_mask & 0x04u) != 0;
    bool pressure_read_valid =
        pressure_0_valid && pressure_1_valid && pressure_2_valid;

    uint8_t sample_saturation_mask =
        pressure_metadata_present
            ? sample->pressure_saturation_mask
            : pressure_saturation_mask(sample);
    if (!pressure_0_valid) sample_saturation_mask &= (uint8_t)~0x01u;
    if (!pressure_1_valid) sample_saturation_mask &= (uint8_t)~0x02u;
    if (!pressure_2_valid) sample_saturation_mask &= (uint8_t)~0x04u;
    sensor_raw_sample_t raw = {
        .pressure_raw = {
            sample->pressure_0_raw,
            sample->pressure_1_raw,
            sample->pressure_2_raw,
        },
        .pressure_read_valid = {
            pressure_0_valid,
            pressure_1_valid,
            pressure_2_valid,
        },
        .hall_raw = sample->hall_raw,
        .hall_read_valid = hall_valid,
        .pressure_saturation_mask = sample_saturation_mask,
        .timestamp_ms = sample->ts_ms,
    };
    sensor_conversion_profile_t profile = conversion_profile_from_calibration(&s_calib);
    sensor_converted_sample_t converted = {0};
    sensor_conversion_convert(&raw, &profile, &converted);

    uint32_t current_quality_flags = 0;
    if (!hall_valid) {
        s_missed_hall_samples++;
        current_quality_flags |= CPR_SENSOR_QUALITY_HALL_MISSED;
    }
    if (!pressure_read_valid) {
        s_missed_pressure_samples++;
        current_quality_flags |= CPR_SENSOR_QUALITY_PRESSURE_MISSED;
    }
    if (pressure_snapshot_metadata_present && !pressure_frame_fresh) {
        current_quality_flags |= CPR_SENSOR_QUALITY_PRESSURE_STALE;
    }
    s_pressure_acquisition_active =
        pressure_metadata_present
            ? sample->pressure_acquisition_active
            : true;
    s_pressure_frame_fresh = pressure_frame_fresh;
    s_pressure_temporarily_degraded =
        pressure_metadata_present
            ? sample->pressure_temporarily_degraded
            : false;
    s_pressure_current_valid_mask = pressure_read_valid_mask;
    s_pressure_invalid_mask =
        (uint8_t)(~pressure_read_valid_mask) &
        CPR_PRESSURE_BALANCE_SENSOR_MASK;

    uint8_t current_saturation_mask =
        (uint8_t)converted.pressure_saturation_mask;
    if (current_saturation_mask != 0) {
        current_quality_flags |= CPR_SENSOR_QUALITY_PRESSURE_SATURATED;
    }

    s_pressure_0_kpa_valid = pressure_0_valid && s_calib.pressure_valid && converted.pressure_kpa_channel_valid[0];
    s_pressure_1_kpa_valid = pressure_1_valid && s_calib.pressure_valid && converted.pressure_kpa_channel_valid[1];
    s_pressure_2_kpa_valid = pressure_2_valid && s_calib.pressure_valid && converted.pressure_kpa_channel_valid[2];
    if (s_pressure_0_kpa_valid) s_pressure_0_kpa = converted.pressure_kpa[0];
    if (s_pressure_1_kpa_valid) s_pressure_1_kpa = converted.pressure_kpa[1];
    if (s_pressure_2_kpa_valid) s_pressure_2_kpa = converted.pressure_kpa[2];
    s_pressure_kpa_valid = s_pressure_0_kpa_valid && s_pressure_1_kpa_valid && s_pressure_2_kpa_valid;
    bool hall_sample_usable = hall_valid && s_calib.hall_valid && converted.hall_mm_valid;
    s_hall_mm_valid = hall_sample_usable;

    float progress = s_depth_progress;
    int32_t hall_delta_now = 0;
    if (hall_sample_usable) {
        hall_delta_now = converted.hall_delta_raw;
        progress = converted.hall_progress;
        s_depth_progress = progress;
        s_depth_mm = converted.hall_mm;
    }

    /*
     * Hall owns the compression lifecycle. Reset pressure evidence before
     * processing the first sample of a new compression so no prior window can
     * leak into the decision.
     */
    bool starts_new_compression =
        hall_sample_usable &&
        s_state == WAITING_FOR_COMPRESSION &&
        hall_delta_now >= s_calib.hall_start_delta;
    if (starts_new_compression) {
        compression_pressure_start();
    }

    bool pressure_unavailable = calibration_uses_hall_only_pressure();

    s_sensor_quality_flags = current_quality_flags;
    if (s_compression_pressure.compression_active) {
        s_pressure_saturation_mask |= current_saturation_mask;
    } else {
        s_pressure_saturation_mask = current_saturation_mask;
    }

    if (pressure_unavailable) {
        s_pressure_balance_reliable = false;
        if (s_compression_pressure.compression_active) {
            strncpy(s_hand_placement, "UNAVAILABLE",
                    sizeof(s_hand_placement) - 1);
            s_hand_placement[sizeof(s_hand_placement) - 1] = '\0';
            s_sensor_quality_flags |=
                CPR_SENSOR_QUALITY_HAND_PLACEMENT_UNAVAILABLE;
        }
    } else if (s_compression_pressure.compression_active) {
        int32_t contact_1 = pressure_contact_delta(
            sample->pressure_1_raw, s_calib.pressure_1_baseline,
            s_calib.bladder_1_full_press);
        int32_t contact_2 = pressure_contact_delta(
            sample->pressure_2_raw, s_calib.pressure_2_baseline,
            s_calib.bladder_2_full_press);
        int32_t contact_threshold =
            s_calib.pressure_contact_threshold > 0
                ? s_calib.pressure_contact_threshold
                : 1;
        uint8_t below_contact_mask = 0;
        if (pressure_1_valid && contact_1 < contact_threshold) {
            below_contact_mask |= 0x02u;
        }
        if (pressure_2_valid && contact_2 < contact_threshold) {
            below_contact_mask |= 0x04u;
        }
        s_pressure_below_contact_mask = below_contact_mask;

        uint8_t upper_limit_mask = 0;
        if (pressure_1_valid &&
            contact_1 > pressure_reliable_contact_limit(
                            s_calib.pressure_1_baseline,
                            s_calib.bladder_1_full_press,
                            s_calib.pressure_1_range_raw)) {
            upper_limit_mask |= 0x02u;
        }
        if (pressure_2_valid &&
            contact_2 > pressure_reliable_contact_limit(
                            s_calib.pressure_2_baseline,
                            s_calib.bladder_2_full_press,
                            s_calib.pressure_2_range_raw)) {
            upper_limit_mask |= 0x04u;
        }
        s_pressure_upper_limit_mask |= upper_limit_mask;
        s_pressure_out_of_range_mask = s_pressure_upper_limit_mask;

        uint8_t required_saturation_mask =
            current_saturation_mask &
            CPR_PRESSURE_BALANCE_SENSOR_MASK;
        if (required_saturation_mask != 0 || upper_limit_mask != 0) {
            if (required_saturation_mask != 0) {
                s_sensor_quality_flags |=
                    CPR_SENSOR_QUALITY_PRESSURE_SATURATED;
            } else {
                s_sensor_quality_flags |=
                    CPR_SENSOR_QUALITY_PRESSURE_OUT_OF_RANGE;
            }
            if (!s_compression_pressure.hand_placement_locked) {
                if (required_saturation_mask != 0) {
                    ESP_LOGI(
                        TAG,
                        "SESSION_PRESSURE_SATURATED compression=%d "
                        "saturation=0x%02x evidence_sufficient=%d",
                        s_total_compressions,
                        required_saturation_mask,
                        s_compression_pressure.evidence_sufficient);
                    compression_pressure_lock(
                        CPR_PRESSURE_LOCK_SATURATION);
                } else {
                    ESP_LOGI(
                        TAG,
                        "SESSION_PRESSURE_UPPER_LIMIT compression=%d "
                        "upper_mask=0x%02x evidence_sufficient=%d",
                        s_total_compressions,
                        upper_limit_mask,
                        s_compression_pressure.evidence_sufficient);
                    compression_pressure_lock(
                        CPR_PRESSURE_LOCK_UPPER_LIMIT);
                }
            }
            s_pressure_decision_usable_mask = 0;
        } else if (pressure_read_valid &&
                   !s_compression_pressure.hand_placement_locked) {
            int64_t total_contact_wide =
                (int64_t)contact_1 + contact_2;
            int32_t total_contact =
                total_contact_wide > INT32_MAX
                    ? INT32_MAX
                    : (int32_t)total_contact_wide;
            if (calib_max_i32(contact_1, contact_2) <
                contact_threshold) {
                s_sensor_quality_flags |=
                    CPR_SENSOR_QUALITY_PRESSURE_BELOW_CONTACT;
                s_pressure_balance_reliable = false;
                s_pressure_stable_mask = 0;
                s_pressure_decision_usable_mask = 0;
            } else {
                int32_t distribution_q15 =
                    pressure_distribution_q15(contact_1, contact_2);
                bool distribution_consistent =
                    compression_distribution_push(distribution_q15);

                s_compression_pressure.last_accepted_raw[0] =
                    sample->pressure_0_raw;
                s_compression_pressure.last_accepted_raw[1] =
                    sample->pressure_1_raw;
                s_compression_pressure.last_accepted_raw[2] =
                    sample->pressure_2_raw;
                s_compression_pressure.has_last_accepted = true;
                s_compression_pressure.last_accepted_timestamp_ms =
                    sample->pressure_timestamp_ms != 0
                        ? sample->pressure_timestamp_ms
                        : sample->ts_ms;
                s_compression_pressure.accumulated_pressure[1] +=
                    contact_1;
                s_compression_pressure.accumulated_pressure[2] +=
                    contact_2;
                s_compression_pressure.accumulated_count++;
                s_compression_pressure.accepted_pressure_samples++;
                s_compression_pressure.last_distribution_q15 =
                    distribution_q15;
                s_compression_pressure.peak_total_contact =
                    calib_max_i32(
                        s_compression_pressure.peak_total_contact,
                        total_contact);
                s_compression_pressure.evidence_sufficient =
                    s_compression_pressure.accepted_pressure_samples >=
                        CPR_HAND_PLACEMENT_MIN_ACCEPTED_FRAMES &&
                    s_compression_pressure.peak_total_contact >=
                        s_calib.pressure_valid_threshold &&
                    distribution_consistent;
                s_compression_pressure.pressure_evidence_available =
                    s_compression_pressure.evidence_sufficient;
                s_pressure_stable_mask =
                    distribution_consistent
                        ? CPR_PRESSURE_BALANCE_SENSOR_MASK
                        : 0;
                s_pressure_decision_usable_mask =
                    distribution_consistent
                        ? CPR_PRESSURE_BALANCE_SENSOR_MASK
                        : 0;

                if (s_compression_pressure.evidence_sufficient) {
                    compression_pressure_update_decision();
                }
                s_pressure_balance_reliable =
                    s_compression_pressure.evidence_sufficient;
                ESP_LOGD(
                    TAG,
                    "Session pressure evidence accepted: compression=%d "
                    "accepted=%u balance_q15=%ld sufficient=%d",
                    s_total_compressions,
                    s_compression_pressure.accepted_pressure_samples,
                    (long)distribution_q15,
                    s_compression_pressure.evidence_sufficient);
            }
        } else {
            s_pressure_balance_reliable = false;
            s_pressure_stable_mask = 0;
            s_pressure_decision_usable_mask = 0;
            if (s_compression_pressure.pressure_evidence_available) {
                s_sensor_quality_flags |=
                    CPR_SENSOR_QUALITY_PRESSURE_BALANCE_HELD;
            }
        }

        if (s_compression_pressure.hand_placement_locked) {
            strncpy(s_hand_placement,
                    s_compression_pressure.locked_hand_placement,
                    sizeof(s_hand_placement) - 1);
            s_hand_placement[sizeof(s_hand_placement) - 1] = '\0';
            s_pressure_balance_pct =
                s_compression_pressure.locked_pressure_balance_pct;
            if (s_compression_pressure.pressure_evidence_available) {
                s_sensor_quality_flags |=
                    CPR_SENSOR_QUALITY_PRESSURE_BALANCE_HELD;
            } else {
                s_sensor_quality_flags |=
                    CPR_SENSOR_QUALITY_HAND_PLACEMENT_UNAVAILABLE;
            }
        }
    }

    /* compression state machine. Without a Hall sample, keep the previous
     * depth/state and wait for a valid depth observation before advancing. */
    int64_t now = sample->ts_ms;
    if (s_state == WAITING_FOR_COMPRESSION &&
        s_last_compression_start_ms > 0 &&
        now - s_last_compression_start_ms > CPR_RATE_STALE_MS) {
        s_rate_cpm = 0.0f;
    }
    if (hall_sample_usable) {
        switch (s_state) {
            case WAITING_FOR_COMPRESSION:
                /* compression start when adaptive hall start delta reached */
                if (hall_delta_now >= s_calib.hall_start_delta) {
                    /* new compression started */
                    s_state = COMPRESSING;
                    /* start new compression and update rate based on start-to-start interval */
                    int64_t prev_start = s_last_compression_start_ms;
                    s_current_compression_start_ms = now;
                    if (s_last_compression_end_ms > 0 &&
                        now >= s_last_compression_end_ms) {
                        s_last_pause_s =
                            (now - s_last_compression_end_ms) / 1000.0f;
                    }
                    s_current_compression_depth_ok = false;
                    s_release_candidate_since_ms = 0;
                    if (prev_start > 0) {
                        int64_t interval_ms = s_current_compression_start_ms - prev_start;
                        if (interval_ms >= 250 && interval_ms <= 3000) {
                            float instant_rate = 60000.0f / (float)interval_ms;
                            if (s_rate_cpm <= 0.1f) {
                                s_rate_cpm = instant_rate;
                            } else {
                                s_rate_cpm = (0.7f * s_rate_cpm) + (0.3f * instant_rate);
                            }
                        }
                    }
                    s_last_compression_start_ms = s_current_compression_start_ms;
                    s_total_compressions++;
                }
                break;

            case COMPRESSING:
                /* use adaptive full-press threshold */
                if (hall_delta_now >= s_calib.hall_full_delta_threshold) {
                    s_state = FULL_PRESS_REACHED;
                    s_current_compression_depth_ok = true;
                    bool pressure_ok =
                        s_compression_pressure.evidence_sufficient;
                    const char *placement =
                        s_compression_pressure.hand_placement_locked
                            ? s_compression_pressure.locked_hand_placement
                            : s_hand_placement;
                    if (pressure_ok &&
                        strcmp(placement, "CENTER") != 0) {
                        pressure_ok = false;
                    }
                    if (pressure_ok || pressure_unavailable) {
                        s_valid_compressions++;
                    }
                }
                if (compression_release_confirmed(
                        hall_delta_now, now)) {
                    /* canceled shallow or recoil detected too early */
                    s_last_compression_depth_ok = s_current_compression_depth_ok;
                    s_last_compression_recoil_ok = true;
                    s_last_compression_incomplete_recoil = false;
                    s_last_compression_end_ms = now;
                    s_state = WAITING_FOR_COMPRESSION;
                    s_release_candidate_since_ms = 0;
                    compression_pressure_end();
                }
                break;

            case FULL_PRESS_REACHED:
                if (hall_delta_now < s_calib.hall_full_delta_threshold) {
                    /* begin releasing phase */
                    s_state = RELEASING;
                    s_release_candidate_since_ms = 0;
                }
                break;

            case RELEASING:
                /* proper recoil handling */
                if (compression_release_confirmed(
                        hall_delta_now, now)) {
                    /* good recoil */
                    s_recoil_ok_count++;
                    s_last_compression_end_ms = now;
                    s_last_compression_depth_ok = s_current_compression_depth_ok;
                    s_last_compression_recoil_ok = true;
                    s_last_compression_incomplete_recoil = false;
                    s_state = WAITING_FOR_COMPRESSION;
                    s_release_candidate_since_ms = 0;
                    compression_pressure_end();
                }
                break;
        }

        /* update previous sample progress for next iteration */
        s_prev_progress = progress;
    }

    xSemaphoreGive(s_mutex);

    return ESP_OK;
}

esp_err_t cpr_metrics_get_snapshot(cpr_metrics_snapshot_t *out_snapshot)
{
    if (out_snapshot == NULL) return ESP_ERR_INVALID_ARG;
    if (s_mutex == NULL) return ESP_ERR_INVALID_STATE;

    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(200)) != pdTRUE) return ESP_ERR_TIMEOUT;

    out_snapshot->depth_progress = s_depth_progress;
    out_snapshot->depth_mm = s_depth_mm;
    out_snapshot->rate_cpm = s_rate_cpm;
    out_snapshot->pause_s = s_last_pause_s;
    if (s_state == WAITING_FOR_COMPRESSION && s_last_compression_end_ms > 0 &&
        s_last_sample_ms >= s_last_compression_end_ms) {
        out_snapshot->pause_s =
            (s_last_sample_ms - s_last_compression_end_ms) / 1000.0f;
    }
    out_snapshot->total_compressions = s_total_compressions;
    out_snapshot->valid_compressions = s_valid_compressions;
    out_snapshot->recoil_ok_count = s_recoil_ok_count;
    out_snapshot->incomplete_recoil_count = s_incomplete_recoil_count;
    out_snapshot->current_depth_in_range = false;
    if (s_calib.hall_range_raw > 0 && s_calib.hall_full_delta_threshold > 0) {
        float full_pct = (float)s_calib.hall_full_delta_threshold / (float)s_calib.hall_range_raw;
        out_snapshot->current_depth_in_range = (s_depth_progress >= full_pct);
    }
    out_snapshot->last_compression_depth_ok = s_last_compression_depth_ok;
    out_snapshot->last_compression_recoil_ok = s_last_compression_recoil_ok;
    out_snapshot->last_compression_incomplete_recoil =
        s_last_compression_incomplete_recoil;
    out_snapshot->depth_ok = out_snapshot->last_compression_depth_ok;
    out_snapshot->recoil_ok = out_snapshot->last_compression_recoil_ok;
    strncpy(out_snapshot->hand_placement, s_hand_placement, sizeof(out_snapshot->hand_placement) - 1);
    out_snapshot->hand_placement[sizeof(out_snapshot->hand_placement) - 1] = '\0';
    out_snapshot->pressure_balance_pct = s_pressure_balance_pct;
    out_snapshot->pressure_balance_reliable = s_pressure_balance_reliable;
    out_snapshot->pressure_mode = s_calib.pressure_mode;
    out_snapshot->pressure_degraded = s_calib.pressure_degraded ||
                                      s_calib.pressure_mode == CALIBRATION_HALL_ONLY ||
                                      s_calib.pressure_mode == CALIBRATION_HALL_WITH_LAST_STABLE_PRESSURE ||
                                      !s_calib.pressure_valid;
    out_snapshot->using_last_stable_pressure = s_calib.using_last_stable_pressure;
    out_snapshot->pressure_valid = s_calib.pressure_valid && !out_snapshot->pressure_degraded;
    out_snapshot->hall_valid = s_calib.hall_valid;
    out_snapshot->pressure_0_kpa = s_pressure_0_kpa;
    out_snapshot->pressure_1_kpa = s_pressure_1_kpa;
    out_snapshot->pressure_2_kpa = s_pressure_2_kpa;
    out_snapshot->pressure_0_kpa_valid = s_pressure_0_kpa_valid;
    out_snapshot->pressure_1_kpa_valid = s_pressure_1_kpa_valid;
    out_snapshot->pressure_2_kpa_valid = s_pressure_2_kpa_valid;
    out_snapshot->pressure_kpa_valid = s_pressure_kpa_valid;
    out_snapshot->hall_mm_valid = s_hall_mm_valid;
    out_snapshot->pressure_acquisition_active =
        s_pressure_acquisition_active;
    out_snapshot->pressure_frame_fresh = s_pressure_frame_fresh;
    out_snapshot->pressure_temporarily_degraded =
        s_pressure_temporarily_degraded;
    out_snapshot->pressure_current_valid_mask =
        s_pressure_current_valid_mask;
    out_snapshot->pressure_invalid_mask = s_pressure_invalid_mask;
    out_snapshot->pressure_saturation_mask = s_pressure_saturation_mask;
    out_snapshot->pressure_upper_limit_mask =
        s_pressure_upper_limit_mask;
    out_snapshot->pressure_below_contact_mask =
        s_pressure_below_contact_mask;
    out_snapshot->pressure_out_of_range_mask =
        s_pressure_out_of_range_mask;
    out_snapshot->pressure_stable_mask = s_pressure_stable_mask;
    out_snapshot->pressure_decision_usable_mask =
        s_pressure_decision_usable_mask;
    out_snapshot->pressure_last_stable_available =
        s_compression_pressure.has_last_accepted;
    out_snapshot->pressure_last_accepted_available =
        s_compression_pressure.has_last_accepted;
    out_snapshot->pressure_last_accepted_age_ms =
        s_compression_pressure.has_last_accepted &&
                s_last_sample_ms >=
                    s_compression_pressure.last_accepted_timestamp_ms
            ? s_last_sample_ms -
                  s_compression_pressure.last_accepted_timestamp_ms
            : 0;
    out_snapshot->pressure_using_last_stable =
        out_snapshot->pressure_last_stable_available &&
        (s_pressure_decision_usable_mask &
         CPR_PRESSURE_BALANCE_SENSOR_MASK) !=
            CPR_PRESSURE_BALANCE_SENSOR_MASK;
    out_snapshot->pressure_evidence_sufficient =
        s_compression_pressure.evidence_sufficient;
    out_snapshot->hand_placement_locked =
        s_compression_pressure.hand_placement_locked;
    out_snapshot->pressure_lock_reason =
        s_compression_pressure.lock_reason;
    out_snapshot->pressure_became_unusable =
        s_compression_pressure.pressure_became_unusable;
    out_snapshot->accepted_pressure_samples =
        s_compression_pressure.accepted_pressure_samples;
    out_snapshot->sensor_quality_flags = s_sensor_quality_flags;
    out_snapshot->missed_pressure_samples = s_missed_pressure_samples;
    out_snapshot->missed_hall_samples = s_missed_hall_samples;
    /* build flags string */
    out_snapshot->flags[0] = '\0';
    size_t pos = 0;
    if (out_snapshot->depth_ok) {
        append_snapshot_flag(out_snapshot->flags, sizeof(out_snapshot->flags), &pos, "DEPTH_OK,");
    }

    /* Only emit rate flags if rate is known (requires at least two compression starts) */
    if (out_snapshot->rate_cpm <= 0.1f) {
        /* rate not known yet: do not add RATE_SLOW/RATE_OK/RATE_FAST */
    } else if (out_snapshot->rate_cpm < 100.0f) {
        append_snapshot_flag(out_snapshot->flags, sizeof(out_snapshot->flags), &pos, "RATE_SLOW,");
    } else if (out_snapshot->rate_cpm <= 120.0f) {
        append_snapshot_flag(out_snapshot->flags, sizeof(out_snapshot->flags), &pos, "RATE_OK,");
    } else {
        append_snapshot_flag(out_snapshot->flags, sizeof(out_snapshot->flags), &pos, "RATE_FAST,");
    }

    if (out_snapshot->last_compression_incomplete_recoil) {
        append_snapshot_flag(out_snapshot->flags, sizeof(out_snapshot->flags), &pos, "INCOMPLETE_RECOIL,");
    } else if (out_snapshot->recoil_ok) {
        append_snapshot_flag(out_snapshot->flags, sizeof(out_snapshot->flags), &pos, "RECOIL_OK,");
    }

    if (out_snapshot->sensor_quality_flags & CPR_SENSOR_QUALITY_PRESSURE_MISSED) {
        append_snapshot_flag(out_snapshot->flags, sizeof(out_snapshot->flags), &pos, "PRESSURE_MISSED,");
    }
    if (out_snapshot->sensor_quality_flags & CPR_SENSOR_QUALITY_HALL_MISSED) {
        append_snapshot_flag(out_snapshot->flags, sizeof(out_snapshot->flags), &pos, "HALL_MISSED,");
    }
    if (out_snapshot->sensor_quality_flags & CPR_SENSOR_QUALITY_PRESSURE_SATURATED) {
        append_snapshot_flag(out_snapshot->flags, sizeof(out_snapshot->flags), &pos, "PRESSURE_SATURATED,");
    }
    if (out_snapshot->sensor_quality_flags &
        CPR_SENSOR_QUALITY_PRESSURE_OUT_OF_RANGE) {
        append_snapshot_flag(out_snapshot->flags,
                             sizeof(out_snapshot->flags),
                             &pos,
                             "PRESSURE_OUT_OF_RANGE,");
    }
    if (out_snapshot->sensor_quality_flags &
        CPR_SENSOR_QUALITY_PRESSURE_BELOW_CONTACT) {
        append_snapshot_flag(out_snapshot->flags,
                             sizeof(out_snapshot->flags),
                             &pos,
                             "PRESSURE_BELOW_CONTACT,");
    }
    if (out_snapshot->sensor_quality_flags &
        CPR_SENSOR_QUALITY_PRESSURE_STALE) {
        append_snapshot_flag(out_snapshot->flags,
                             sizeof(out_snapshot->flags),
                             &pos,
                             "PRESSURE_STALE,");
    }
    if (out_snapshot->sensor_quality_flags & CPR_SENSOR_QUALITY_PRESSURE_BALANCE_HELD) {
        append_snapshot_flag(out_snapshot->flags, sizeof(out_snapshot->flags), &pos, "PRESSURE_BALANCE_HELD,");
    }
    if (out_snapshot->sensor_quality_flags &
        CPR_SENSOR_QUALITY_HAND_PLACEMENT_UNAVAILABLE) {
        append_snapshot_flag(out_snapshot->flags,
                             sizeof(out_snapshot->flags),
                             &pos,
                             "HAND_PLACEMENT_UNAVAILABLE,");
    }
    if (out_snapshot->sensor_quality_flags &
        CPR_SENSOR_QUALITY_PRESSURE_UNSTABLE) {
        append_snapshot_flag(out_snapshot->flags,
                             sizeof(out_snapshot->flags),
                             &pos,
                             "PRESSURE_UNSTABLE,");
    }
    if (out_snapshot->hand_placement_locked) {
        append_snapshot_flag(out_snapshot->flags,
                             sizeof(out_snapshot->flags),
                             &pos,
                             "HAND_PLACEMENT_LOCKED,");
    }
    if (calibration_uses_hall_only_pressure()) {
        append_snapshot_flag(out_snapshot->flags, sizeof(out_snapshot->flags), &pos, "HALL_ONLY,PRESSURE_UNAVAILABLE,");
    }

    if (strcmp(out_snapshot->hand_placement, "CENTER") == 0) {
        append_snapshot_flag(out_snapshot->flags, sizeof(out_snapshot->flags), &pos, "HAND_CENTERED");
    } else if (strcmp(out_snapshot->hand_placement, "LEFT") == 0) {
        append_snapshot_flag(out_snapshot->flags, sizeof(out_snapshot->flags), &pos, "HAND_LEFT");
    } else if (strcmp(out_snapshot->hand_placement, "RIGHT") == 0) {
        append_snapshot_flag(out_snapshot->flags, sizeof(out_snapshot->flags), &pos, "HAND_RIGHT");
    } else {
        /* NO_CONTACT -> leave empty or no flag */
    }
    out_snapshot->flags[sizeof(out_snapshot->flags) - 1] = '\0';
    out_snapshot->ts_ms = s_last_sample_ms;

    xSemaphoreGive(s_mutex);

    return ESP_OK;
}

const char *cpr_pressure_lock_reason_to_string(
    cpr_pressure_lock_reason_t reason)
{
    switch (reason) {
        case CPR_PRESSURE_LOCK_UPPER_LIMIT:
            return "UPPER_LIMIT";
        case CPR_PRESSURE_LOCK_SATURATION:
            return "SATURATION";
        case CPR_PRESSURE_LOCK_NONE:
        default:
            return "NONE";
    }
}

int32_t hall_sensor_compute_delta(int32_t raw_value,
                                  int32_t baseline,
                                  int32_t direction)
{
    int32_t hall_dir = direction == 0 ? 1 : direction;
    return (raw_value - baseline) * hall_dir;
}

int32_t pressure_sensor_compute_balance_pct(int32_t pressure_1_delta,
                                            int32_t pressure_2_delta,
                                            int32_t pressure_1_range_raw,
                                            int32_t pressure_2_range_raw)
{
    int32_t p1_delta = calib_abs_i32(pressure_1_delta);
    int32_t p2_delta = calib_abs_i32(pressure_2_delta);
    int64_t p1_normalized = pressure_1_range_raw > 0
                                 ? ((int64_t)p1_delta * 1000) / pressure_1_range_raw
                                 : p1_delta;
    int64_t p2_normalized = pressure_2_range_raw > 0
                                 ? ((int64_t)p2_delta * 1000) / pressure_2_range_raw
                                 : p2_delta;
    int64_t total = p1_normalized + p2_normalized;

    if (total <= 0) {
        return 100;
    }

    return (int32_t)(llabs(p1_normalized - p2_normalized) * 100 / total);
}

esp_err_t pressure_sensor_evaluate_window(const int32_t *pressure_1_samples,
                                          const int32_t *pressure_2_samples,
                                          size_t sample_count,
                                          size_t baseline_sample_count,
                                          const calibration_config_t *calibration,
                                          cpr_pressure_window_result_t *out_result)
{
    if (pressure_1_samples == NULL || pressure_2_samples == NULL ||
        calibration == NULL || out_result == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    memset(out_result, 0, sizeof(*out_result));
    out_result->health = CPR_SENSOR_HEALTH_FAIL;
    out_result->imbalance_pct = 100;

    if (sample_count == 0 || baseline_sample_count == 0 ||
        baseline_sample_count > sample_count) {
        out_result->fault_flags |= CPR_SENSOR_FAULT_TOO_FEW_SAMPLES;
        return ESP_OK;
    }

    out_result->baseline_1 = average_i32(pressure_1_samples, baseline_sample_count);
    out_result->baseline_2 = average_i32(pressure_2_samples, baseline_sample_count);
    out_result->noise_1 = peak_to_peak_i32(pressure_1_samples, baseline_sample_count);
    out_result->noise_2 = peak_to_peak_i32(pressure_2_samples, baseline_sample_count);

    const int32_t noise_limit_1 = calibration->pressure_1_noise_raw > 0
                                      ? calibration->pressure_1_noise_raw
                                      : calibration->pressure_contact_threshold / 2;
    const int32_t noise_limit_2 = calibration->pressure_2_noise_raw > 0
                                      ? calibration->pressure_2_noise_raw
                                      : calibration->pressure_contact_threshold / 2;

    out_result->baseline_stable =
        out_result->noise_1 <= noise_limit_1 &&
        out_result->noise_2 <= noise_limit_2;

    if (!out_result->baseline_stable) {
        out_result->fault_flags |= CPR_SENSOR_FAULT_NOISY_BASELINE;
    }

    if ((out_result->baseline_1 == 0 && out_result->baseline_2 == 0) ||
        (all_samples_equal(pressure_1_samples, sample_count) &&
         all_samples_equal(pressure_2_samples, sample_count) &&
         pressure_1_samples[0] == 0 && pressure_2_samples[0] == 0)) {
        out_result->fault_flags |= CPR_SENSOR_FAULT_STUCK_ZERO;
    }

    bool saturated = false;
    for (size_t i = 0; i < sample_count; i++) {
        saturated = saturated ||
                    pressure_raw_is_saturated(pressure_1_samples[i]) ||
                    pressure_raw_is_saturated(pressure_2_samples[i]);

        int32_t p1_delta = calib_abs_diff_i32(pressure_1_samples[i],
                                              out_result->baseline_1);
        int32_t p2_delta = calib_abs_diff_i32(pressure_2_samples[i],
                                              out_result->baseline_2);
        out_result->max_delta_1 = calib_max_i32(out_result->max_delta_1, p1_delta);
        out_result->max_delta_2 = calib_max_i32(out_result->max_delta_2, p2_delta);
    }

    if (saturated) {
        out_result->fault_flags |= CPR_SENSOR_FAULT_SATURATED;
    }

    if (sample_count >= 8 &&
        all_samples_equal(pressure_1_samples, sample_count) &&
        all_samples_equal(pressure_2_samples, sample_count)) {
        out_result->fault_flags |= CPR_SENSOR_FAULT_STUCK_NO_CHANGE;
    }

    out_result->response_delta =
        calib_max_i32(out_result->max_delta_1, out_result->max_delta_2);
    out_result->response_detected =
        out_result->response_delta >= calibration->pressure_valid_threshold;

    out_result->release_delta_1 =
        calib_abs_diff_i32(pressure_1_samples[sample_count - 1],
                           out_result->baseline_1);
    out_result->release_delta_2 =
        calib_abs_diff_i32(pressure_2_samples[sample_count - 1],
                           out_result->baseline_2);
    out_result->release_near_baseline =
        out_result->release_delta_1 <= calibration->pressure_contact_threshold &&
        out_result->release_delta_2 <= calibration->pressure_contact_threshold;

    if (out_result->response_detected && !out_result->release_near_baseline) {
        out_result->fault_flags |= CPR_SENSOR_FAULT_RELEASE_NOT_NEAR_BASELINE;
    }

    out_result->imbalance_pct = pressure_sensor_compute_balance_pct(
        out_result->max_delta_1,
        out_result->max_delta_2,
        calibration->pressure_1_range_raw,
        calibration->pressure_2_range_raw);
    out_result->balanced =
        out_result->imbalance_pct <= calibration->pressure_balance_allowed_pct;

    if (out_result->response_detected && !out_result->balanced) {
        out_result->fault_flags |= CPR_SENSOR_FAULT_IMBALANCED;
    }

    out_result->health = health_from_faults(out_result->fault_flags);
    return ESP_OK;
}

esp_err_t hall_sensor_evaluate_window(const int32_t *hall_samples,
                                      size_t sample_count,
                                      size_t baseline_sample_count,
                                      const calibration_config_t *calibration,
                                      cpr_hall_window_result_t *out_result)
{
    if (hall_samples == NULL || calibration == NULL || out_result == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    memset(out_result, 0, sizeof(*out_result));
    out_result->health = CPR_SENSOR_HEALTH_FAIL;

    if (sample_count == 0 || baseline_sample_count == 0 ||
        baseline_sample_count > sample_count) {
        out_result->fault_flags |= CPR_SENSOR_FAULT_TOO_FEW_SAMPLES;
        return ESP_OK;
    }

    if (!(calibration->hall_direction == 1 || calibration->hall_direction == -1) ||
        calibration->hall_range_raw <= 0) {
        out_result->fault_flags |= CPR_SENSOR_FAULT_INVALID_RANGE;
        return ESP_OK;
    }

    out_result->baseline = average_i32(hall_samples, baseline_sample_count);
    out_result->noise = peak_to_peak_i32(hall_samples, baseline_sample_count);

    const int32_t noise_limit = calibration->hall_noise_raw > 0
                                    ? calibration->hall_noise_raw
                                    : calibration->hall_tolerance_raw;
    out_result->baseline_stable = out_result->noise <= noise_limit;
    if (!out_result->baseline_stable) {
        out_result->fault_flags |= CPR_SENSOR_FAULT_NOISY_BASELINE;
    }

    if (out_result->baseline <= 0) {
        out_result->fault_flags |= CPR_SENSOR_FAULT_STUCK_ZERO;
    }

    bool saturated = false;
    for (size_t i = 0; i < sample_count; i++) {
        saturated = saturated ||
                    hall_samples[i] <= 0 ||
                    hall_samples[i] >= CPR_HALL_ADC_MAX_RAW;
        int32_t delta = hall_sensor_compute_delta(hall_samples[i],
                                                  out_result->baseline,
                                                  calibration->hall_direction);
        out_result->max_delta = calib_max_i32(out_result->max_delta, delta);
    }

    if (saturated) {
        out_result->fault_flags |= CPR_SENSOR_FAULT_SATURATED;
    }

    if (sample_count >= 8 && all_samples_equal(hall_samples, sample_count)) {
        out_result->fault_flags |= CPR_SENSOR_FAULT_STUCK_NO_CHANGE;
    }

    out_result->movement_detected =
        out_result->max_delta >= calibration->hall_start_delta;
    out_result->full_depth_detected =
        out_result->max_delta >= calibration->hall_full_delta_threshold;
    out_result->depth_progress = clampf((float)out_result->max_delta /
                                            (float)calibration->hall_range_raw,
                                        0.0f,
                                        1.0f);

    out_result->release_delta = calib_abs_i32(hall_sensor_compute_delta(
        hall_samples[sample_count - 1],
        out_result->baseline,
        calibration->hall_direction));
    out_result->recoil_detected =
        out_result->release_delta <=
        calibration->hall_recoil_delta + calibration->hall_tolerance_raw;

    if (out_result->movement_detected && !out_result->recoil_detected) {
        out_result->fault_flags |= CPR_SENSOR_FAULT_RELEASE_NOT_NEAR_BASELINE;
    }

    out_result->health = health_from_faults(out_result->fault_flags);
    return ESP_OK;
}

esp_err_t sensor_readiness_evaluate(const cpr_pressure_window_result_t *pressure,
                                    const cpr_hall_window_result_t *hall,
                                    cpr_sensor_readiness_result_t *out_result)
{
    if (pressure == NULL || hall == NULL || out_result == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    memset(out_result, 0, sizeof(*out_result));
    out_result->pressure_fault_flags = pressure->fault_flags;
    out_result->hall_fault_flags = hall->fault_flags;
    out_result->pressure_ok = pressure->health == CPR_SENSOR_HEALTH_OK;
    out_result->hall_ok = hall->health == CPR_SENSOR_HEALTH_OK;

    if (!out_result->pressure_ok || !out_result->hall_ok) {
        out_result->readiness = CPR_READINESS_NOT_READY;
        out_result->health = CPR_SENSOR_HEALTH_FAIL;
    } else if (pressure->fault_flags != CPR_SENSOR_FAULT_NONE ||
               hall->fault_flags != CPR_SENSOR_FAULT_NONE) {
        out_result->readiness = CPR_READINESS_WARNING;
        out_result->health = CPR_SENSOR_HEALTH_WARNING;
    } else {
        out_result->readiness = CPR_READINESS_READY_FOR_SESSION;
        out_result->health = CPR_SENSOR_HEALTH_OK;
    }

    return ESP_OK;
}
