#include "calibration_manager.h"

#include <stdlib.h>
#include <string.h>
#include <limits.h>

#include "esp_err.h"
#include "esp_log.h"
#include "esp_timer.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "board_config.h"
#include "config_store.h"
#include "hall_sensor.h"
#include "hx710.h"
#include "status_indicator.h"
#include "states.h"
#include "runtime_helpers.h"
#include "mqtt_manager.h"
#include "mqtt_topics.h"
#include "calibration_codes.h"
#include "cJSON.h"

/* Calibration manager configuration */
#define CALIBRATION_TASK_STACK_SIZE             6144
#define CALIBRATION_TASK_PRIORITY               5

#define CALIBRATION_POLL_DELAY_MS               50
#define CALIBRATION_MAX_WAIT_MS                 30000

/* Stable sampling configuration. */
#define CALIBRATION_REST_OBSERVATIONS           60
#define CALIBRATION_MAX_INVALID_PERCENT         20
#define CALIBRATION_MAX_STATS_SAMPLES           64
#define CALIBRATION_NOISE_TRIM_PERCENT          10
#define CALIBRATION_HALL_AVERAGE_SAMPLE_COUNT   20
#define CALIBRATION_PRESSURE_AVERAGE_SAMPLE_COUNT 20
#define CALIBRATION_FULL_PRESS_HOLD_SAMPLES     5
#define CALIBRATION_FULL_PRESS_CAPTURE_SAMPLES  20
#define CALIBRATION_CAPTURE_SAMPLE_DELAY_MS     20

/* Noise margins used to keep runtime thresholds above normal sensor jitter. */
#define CALIBRATION_HALL_NOISE_MARGIN_MULTIPLIER       4
#define CALIBRATION_PRESSURE_CONTACT_NOISE_MULTIPLIER  4
#define CALIBRATION_PRESSURE_MIN_SNR_MULTIPLIER        5

/* Stuck-zero detection: consider values very close to zero as suspicious */
#define CALIBRATION_STUCK_ZERO_NEAR_ZERO_RAW    8
#define CALIBRATION_STUCK_ZERO_THRESHOLD_COUNT  3

/* Private variables */
static const char *TAG = "calibration_manager";

static TaskHandle_t s_calibration_task_handle = NULL;

static calibration_config_t s_calibration_config;

static hall_sensor_t s_hall_sensor;

static network_config_t s_network_config;

/* Track consecutive near-zero readings per HX710 sensor (indices 0..2) */
static int s_hx710_zero_streaks[3] = {0, 0, 0};

/* Last raw triplet from the shared HX710 read (for logging) */
static int32_t s_last_hx710_raw[3] = {0, 0, 0};

/* current command id for the running calibration */
static char s_command_id[64] = {0};

/* request_id provided by LocalHub for replies (reply_id) */
static char s_request_id[128] = {0};

/* Store the request_id for the running calibration. Used as reply_id in events. */
void calibration_manager_set_request_id(const char *request_id)
{
    if (request_id == NULL) {
        s_request_id[0] = '\0';
        return;
    }

    strncpy(s_request_id, request_id, sizeof(s_request_id) - 1);
    s_request_id[sizeof(s_request_id) - 1] = '\0';
}

const char *calibration_manager_get_request_id(void)
{
    return s_request_id;
}

static bool s_initialized = false;
static bool s_running = false;
static calibration_reason_id_t s_last_failure_reason = CAL_REASON_NONE;
static calibration_action_id_t s_last_failure_action = CAL_ACTION_NONE;
static calibration_config_t s_last_host_params;
static bool s_has_last_host_params = false;

/* Forward declaration for failure helper used by earlier functions */
static void calibration_manager_fail(calibration_reason_id_t reason_id);

/* =========================================================
 * Small internal helper functions
 * ========================================================= */

static void publish_calibration_progress(calibration_reason_id_t reason_id,
                                         resq_state_t state,
                                         calibration_action_id_t action_id)
{
    char payload[256];

    /* Use numeric event_id for calibration progress and publish to standard calibration events topic */
    int written = snprintf(payload,
                           sizeof(payload),
                           "{"
                           "\"event_id\":%d," 
                           "\"reason_id\":%d," 
                           "\"state\":\"%s\"," 
                           "\"action_id\":%d," 
                           "\"ts_ms\":%lld"
                           "}",
                           4001,
                           (int)reason_id,
                           resq_state_to_string(state),
                           (int)action_id,
                           (long long)(esp_timer_get_time() / 1000));

    if (written <= 0 || written >= (int)sizeof(payload)) {
        ESP_LOGE(TAG, "Calibration progress payload too large");
        return;
    }

    if (mqtt_manager_is_connected()) {
        mqtt_manager_publish_topic_json(RESQ_SUFFIX_EVENTS_CALIBRATION, payload);
    }
}

/**
 * @brief Return absolute difference between two int32_t values.
 */
static int32_t calibration_abs_diff(int32_t a, int32_t b)
{
    int32_t diff = a - b;
    return diff < 0 ? -diff : diff;
}

/**
 * @brief Check whether a reading is inside target +/- tolerance.
 */
static bool calibration_is_within_tolerance(int32_t reading,
                                            int32_t target,
                                            int32_t tolerance)
{
    return calibration_abs_diff(reading, target) <= tolerance;
}

/**
 * @brief Detect 24-bit ADC saturation sentinel values used by HX710.
 */
static bool calibration_is_saturated_24bit(int32_t value)
{
    return value > 8300000 || value < -8300000;
}

/* Calibration signal stats type (full definition needed by functions that access fields) */
typedef struct calibration_signal_stats_t {
    int64_t sum;
    int32_t mean;
    int32_t min;
    int32_t max;
    int32_t noise_pp; /* trimmed peak-to-peak spread, resistant to isolated spikes */
    int32_t last;
    int valid_count;
    int32_t samples[CALIBRATION_MAX_STATS_SAMPLES];
} calibration_signal_stats_t;

typedef struct calibration_sample_t {
    int32_t hall;
    int32_t p0;
    int32_t p1;
    int32_t p2;
} calibration_sample_t;

/* Forward prototypes for static helpers defined later */
static void calibration_stats_init(calibration_signal_stats_t *s);
static void calibration_stats_update(calibration_signal_stats_t *s, int32_t value);
static void calibration_stats_finalize(calibration_signal_stats_t *s);
static void calibration_sort_i32(int32_t *values, int count);
static int32_t calibration_max_i32(int32_t a, int32_t b);
static int32_t calibration_min_i32(int32_t a, int32_t b);
static int32_t calibration_abs_i32(int32_t v);
static int32_t calibration_adaptive_pressure_tolerance(int32_t target, int32_t noise_raw);
static int32_t calibration_adaptive_hall_tolerance(int32_t hall_range, int32_t noise_raw);
static esp_err_t calibration_read_hall_average(int32_t *out_value);
static esp_err_t calibration_validate_pressure_triplet(int32_t v0, int32_t v1, int32_t v2);
static esp_err_t calibration_read_valid_sample(calibration_sample_t *out_sample);
static esp_err_t calibration_read_pressure_average(gpio_num_t sck_pin, gpio_num_t dout_pin, int32_t *out_value);
static calibration_reason_id_t calibration_validate_derived_thresholds(void);
static calibration_reason_id_t calibration_validate_pressure_rest_health(
    const calibration_signal_stats_t *p0_stats,
    const calibration_signal_stats_t *p1_stats,
    const calibration_signal_stats_t *p2_stats);
static esp_err_t calibration_read_three_pressure_average(int32_t *out_v0, int32_t *out_v1, int32_t *out_v2);
static esp_err_t calibration_capture_full_press_batch(int hall_direction,
                                                      int32_t hold_boundary,
                                                      int32_t *out_hall,
                                                      int32_t *out_p1,
                                                      int32_t *out_p2);
static bool calibration_is_saturated_24bit(int32_t value);
static calibration_reason_id_t calibration_validate_pressure_rest_health(
    const calibration_signal_stats_t *p0,
    const calibration_signal_stats_t *p1,
    const calibration_signal_stats_t *p2);

/* Collect rest statistics for Hall and the three pressure sensors.
 * Caller must ensure s_calibration_config.calibration_sample_count and
 * calibration_window_ms are set to sensible values (defaults provided).
 */
static esp_err_t calibration_collect_rest_stats(calibration_signal_stats_t *hall_stats,
                                               calibration_signal_stats_t *p0_stats,
                                               calibration_signal_stats_t *p1_stats,
                                               calibration_signal_stats_t *p2_stats)
{
    if (!hall_stats || !p0_stats || !p1_stats || !p2_stats) return ESP_ERR_INVALID_ARG;

    calibration_stats_init(hall_stats);
    calibration_stats_init(p0_stats);
    calibration_stats_init(p1_stats);
    calibration_stats_init(p2_stats);

    int sample_count = s_calibration_config.calibration_sample_count > 0
                           ? s_calibration_config.calibration_sample_count
                           : CALIBRATION_REST_OBSERVATIONS;
    if (sample_count < CALIBRATION_REST_OBSERVATIONS) {
        sample_count = CALIBRATION_REST_OBSERVATIONS;
    }
    if (sample_count > CALIBRATION_MAX_STATS_SAMPLES) {
        ESP_LOGW(TAG, "Calibration sample count %d capped at %d",
                 sample_count, CALIBRATION_MAX_STATS_SAMPLES);
        sample_count = CALIBRATION_MAX_STATS_SAMPLES;
    }
    s_calibration_config.calibration_sample_count = sample_count;

    int window_ms = s_calibration_config.calibration_window_ms > 0 ? s_calibration_config.calibration_window_ms : 2000;
    int delay_ms = window_ms / sample_count;
    if (delay_ms < 5) delay_ms = 5;

    int max_attempts = (sample_count * 100 +
                        (100 - CALIBRATION_MAX_INVALID_PERCENT) - 1) /
                       (100 - CALIBRATION_MAX_INVALID_PERCENT);
    int attempts = 0;
    int valid = 0;

    while (valid < sample_count && attempts < max_attempts && s_running) {
        calibration_sample_t sample = {0};
        attempts++;

        esp_err_t err = calibration_read_valid_sample(&sample);
        if (err == ESP_OK) {
            calibration_stats_update(hall_stats, sample.hall);
            calibration_stats_update(p0_stats, sample.p0);
            calibration_stats_update(p1_stats, sample.p1);
            calibration_stats_update(p2_stats, sample.p2);
            valid++;
        } else {
            ESP_LOGW(TAG,
                     "Discarding invalid rest observation %d/%d: %s",
                     attempts,
                     max_attempts,
                     esp_err_to_name(err));
        }

        vTaskDelay(pdMS_TO_TICKS(delay_ms));
    }

    if (!s_running) {
        return ESP_ERR_INVALID_STATE;
    }

    if (valid < sample_count) {
        ESP_LOGW(TAG,
                 "Insufficient valid rest observations: valid=%d required=%d attempts=%d max_attempts=%d",
                 valid,
                 sample_count,
                 attempts,
                 max_attempts);
        return ESP_ERR_INVALID_RESPONSE;
    }

    calibration_stats_finalize(hall_stats);
    calibration_stats_finalize(p0_stats);
    calibration_stats_finalize(p1_stats);
    calibration_stats_finalize(p2_stats);

    ESP_LOGI(TAG,
             "Collected stable rest observations: valid=%d attempts=%d invalid=%d",
             valid,
             attempts,
             attempts - valid);

    return ESP_OK;
}

static esp_err_t calibration_capture_full_press_batch(int hall_direction,
                                                      int32_t hold_boundary,
                                                      int32_t *out_hall,
                                                      int32_t *out_p1,
                                                      int32_t *out_p2)
{
    if ((hall_direction != 1 && hall_direction != -1) ||
        out_hall == NULL ||
        out_p1 == NULL ||
        out_p2 == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    calibration_signal_stats_t hall_stats;
    calibration_signal_stats_t p0_stats;
    calibration_signal_stats_t p1_stats;
    calibration_signal_stats_t p2_stats;
    calibration_stats_init(&hall_stats);
    calibration_stats_init(&p0_stats);
    calibration_stats_init(&p1_stats);
    calibration_stats_init(&p2_stats);

    const int max_attempts =
        (CALIBRATION_FULL_PRESS_CAPTURE_SAMPLES * 100 +
         (100 - CALIBRATION_MAX_INVALID_PERCENT) - 1) /
        (100 - CALIBRATION_MAX_INVALID_PERCENT);
    int attempts = 0;
    int valid = 0;

    while (valid < CALIBRATION_FULL_PRESS_CAPTURE_SAMPLES &&
           attempts < max_attempts &&
           s_running) {
        calibration_sample_t sample = {0};
        attempts++;

        esp_err_t err = calibration_read_valid_sample(&sample);
        if (err != ESP_OK) {
            ESP_LOGW(TAG,
                     "Discarding invalid full-press observation %d/%d: %s",
                     attempts,
                     max_attempts,
                     esp_err_to_name(err));
            vTaskDelay(pdMS_TO_TICKS(CALIBRATION_CAPTURE_SAMPLE_DELAY_MS));
            continue;
        }

        int32_t directional_delta =
            (sample.hall - s_calibration_config.hall_baseline) * hall_direction;
        if (directional_delta < hold_boundary) {
            ESP_LOGW(TAG,
                     "Full press released during capture: delta=%ld boundary=%ld valid=%d",
                     (long)directional_delta,
                     (long)hold_boundary,
                     valid);
            return ESP_ERR_INVALID_STATE;
        }

        calibration_stats_update(&hall_stats, sample.hall);
        calibration_stats_update(&p0_stats, sample.p0);
        calibration_stats_update(&p1_stats, sample.p1);
        calibration_stats_update(&p2_stats, sample.p2);
        valid++;

        vTaskDelay(pdMS_TO_TICKS(CALIBRATION_CAPTURE_SAMPLE_DELAY_MS));
    }

    if (!s_running) {
        return ESP_ERR_INVALID_STATE;
    }

    if (valid < CALIBRATION_FULL_PRESS_CAPTURE_SAMPLES) {
        ESP_LOGW(TAG,
                 "Insufficient valid full-press observations: valid=%d required=%d attempts=%d",
                 valid,
                 CALIBRATION_FULL_PRESS_CAPTURE_SAMPLES,
                 attempts);
        return ESP_ERR_INVALID_RESPONSE;
    }

    calibration_stats_finalize(&hall_stats);
    calibration_stats_finalize(&p0_stats);
    calibration_stats_finalize(&p1_stats);
    calibration_stats_finalize(&p2_stats);

    *out_hall = hall_stats.mean;
    *out_p1 = p1_stats.mean;
    *out_p2 = p2_stats.mean;

    ESP_LOGI(TAG,
             "Stable full-press batch: hall=%ld p1=%ld p2=%ld hall_noise=%ld p1_noise=%ld p2_noise=%ld",
             (long)hall_stats.mean,
             (long)p1_stats.mean,
             (long)p2_stats.mean,
             (long)hall_stats.noise_pp,
             (long)p1_stats.noise_pp,
             (long)p2_stats.noise_pp);

    return ESP_OK;
}

/* Collect full-press stats: require a sustained Hall threshold crossing, then
 * capture a stable trimmed batch while the operator continues holding.
 */
static esp_err_t calibration_collect_full_press_stats(int32_t expected_delta,
                                                     int32_t *out_hall_match,
                                                     int32_t *out_b1_full,
                                                     int32_t *out_b2_full,
                                                     calibration_signal_stats_t *rest_hall_stats,
                                                     calibration_reason_id_t *out_failure_reason)
{
    if (out_failure_reason != NULL) {
        *out_failure_reason = CAL_REASON_NONE;
    }

    if (out_hall_match == NULL || out_b1_full == NULL || out_b2_full == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    /* Make the expected delta direction-safe and validate it's large enough */
    int32_t expected_range = calibration_abs_i32(expected_delta);
    if (expected_range < CALIBRATION_HALL_DELTA_MIN_RAW ||
        expected_range > CALIBRATION_HALL_ADC_MAX_RAW) {
        ESP_LOGW(TAG,
                 "Expected hall delta outside supported range %d..%d: %ld",
                 CALIBRATION_HALL_DELTA_MIN_RAW,
                 CALIBRATION_HALL_ADC_MAX_RAW,
                 (long)expected_range);
        return ESP_ERR_INVALID_ARG;
    }

    int32_t max_reachable_range = calibration_max_i32(
        s_calibration_config.hall_baseline,
        CALIBRATION_HALL_ADC_MAX_RAW - s_calibration_config.hall_baseline);
    if (expected_range > max_reachable_range) {
        ESP_LOGW(TAG,
                 "Hall delta %ld exceeds the %ld-count range reachable from baseline %ld; clamping detection range",
                 (long)expected_range,
                 (long)max_reachable_range,
                 (long)s_calibration_config.hall_baseline);
        expected_range = max_reachable_range;
    }

    /* compute initial adaptive thresholds using expected range and measured noise */
    int32_t hall_noise = rest_hall_stats ? rest_hall_stats->noise_pp : 0;
    int32_t hall_noise_margin = calibration_max_i32(
        hall_noise * CALIBRATION_HALL_NOISE_MARGIN_MULTIPLIER, 20);
    int32_t hall_hysteresis = calibration_max_i32(hall_noise * 2, 10);

    int32_t start_thresh = calibration_max_i32((expected_range * 15) / 100, hall_noise_margin);
    int32_t full_thresh = calibration_max_i32(
        (expected_range * CALIBRATION_FULL_PRESS_RATIO_PCT) / 100,
        start_thresh + hall_hysteresis);
    if (full_thresh > expected_range) {
        full_thresh = expected_range;
    }
    int32_t recoil_thresh = calibration_max_i32(
        (expected_range * 10) / 100,
        calibration_max_i32(hall_noise * 2, 10));
    if (recoil_thresh >= start_thresh) {
        recoil_thresh = calibration_max_i32(1, start_thresh / 2);
    }

    ESP_LOGI(TAG, "Adaptive detection: start=%ld full=%ld recoil=%ld noise=%ld",
             (long)start_thresh, (long)full_thresh, (long)recoil_thresh, (long)hall_noise);

    int64_t started_ms = esp_timer_get_time() / 1000;
    int32_t peak_delta = 0;
    int32_t peak_hall_value = s_calibration_config.hall_baseline;
    int hold_count = 0;
    int hold_dir = 0;
    int last_log_ms = -500; /* throttle live logs to every 500ms */
    int32_t hold_boundary = calibration_max_i32(1, full_thresh - hall_hysteresis);

    while (s_running) {
        int elapsed_ms = (int)((esp_timer_get_time() / 1000) - started_ms);
        if (elapsed_ms >= CALIBRATION_MAX_WAIT_MS) {
            break;
        }

        calibration_sample_t sample = {0};
        esp_err_t err = calibration_read_valid_sample(&sample);
        if (err != ESP_OK) {
            hold_count = 0;
            hold_dir = 0;
            ESP_LOGW(TAG, "Sensor read failed during full-press wait: %s", esp_err_to_name(err));
            vTaskDelay(pdMS_TO_TICKS(CALIBRATION_POLL_DELAY_MS));
            continue;
        }

        int32_t hv = sample.hall;
        int32_t delta = calibration_abs_i32(hv - s_calibration_config.hall_baseline);
        int sample_dir = hv >= s_calibration_config.hall_baseline ? 1 : -1;
        if (delta > peak_delta) {
            peak_delta = delta;
            peak_hall_value = hv;
        }

        if (delta >= full_thresh) {
            if (hold_count == 0 || sample_dir == hold_dir) {
                hold_dir = sample_dir;
                hold_count++;
            } else {
                hold_dir = sample_dir;
                hold_count = 1;
            }
        } else {
            hold_count = 0;
            hold_dir = 0;
        }

        /* Throttled live logging for debugging during full-press wait */
        if ((elapsed_ms - last_log_ms) >= 500) {
            ESP_LOGI(TAG,
                     "Hall full-press wait: hall=%ld baseline=%ld delta=%ld peak_delta=%ld required=%ld "
                     "p1_delta=%ld p2_delta=%ld hold=%d/%d elapsed=%d",
                     (long)hv,
                     (long)s_calibration_config.hall_baseline,
                     (long)delta,
                     (long)peak_delta,
                     (long)full_thresh,
                     (long)calibration_abs_diff(sample.p1, s_calibration_config.pressure_1_baseline),
                     (long)calibration_abs_diff(sample.p2, s_calibration_config.pressure_2_baseline),
                     hold_count,
                     CALIBRATION_FULL_PRESS_HOLD_SAMPLES,
                     elapsed_ms);
            last_log_ms = elapsed_ms;
        }

        if (hold_count >= CALIBRATION_FULL_PRESS_HOLD_SAMPLES) {
            ESP_LOGI(TAG,
                     "Full press confirmed; capturing %d stable observations above delta %ld",
                     CALIBRATION_FULL_PRESS_CAPTURE_SAMPLES,
                     (long)hold_boundary);

            err = calibration_capture_full_press_batch(hold_dir,
                                                       hold_boundary,
                                                       out_hall_match,
                                                       out_b1_full,
                                                       out_b2_full);
            if (err == ESP_OK) {
                s_calibration_config.hall_direction = hold_dir;
                return ESP_OK;
            }

            if (!s_running) {
                return ESP_ERR_INVALID_STATE;
            }

            if (err == ESP_ERR_INVALID_STATE) {
                ESP_LOGW(TAG, "Full press was not held; waiting for another stable press");
                hold_count = 0;
                hold_dir = 0;
                continue;
            }

            return err;
        }

        vTaskDelay(pdMS_TO_TICKS(CALIBRATION_POLL_DELAY_MS));
    }

    ESP_LOGE(TAG,
             "Hall full press timeout: peak_delta=%ld peak_hall=%ld baseline=%ld required=%ld",
             (long)peak_delta,
             (long)peak_hall_value,
             (long)s_calibration_config.hall_baseline,
             (long)full_thresh);

    if (peak_delta <= hall_noise_margin) {
        ESP_LOGE(TAG,
                 "No Hall movement exceeded noise margin %ld; check Hall power, ADC channel wiring, and magnet alignment",
                 (long)hall_noise_margin);
        if (out_failure_reason != NULL) {
            *out_failure_reason = CAL_REASON_HALL_RANGE_TOO_SMALL;
        }
    } else if (out_failure_reason != NULL) {
        *out_failure_reason = CAL_REASON_HALL_FULL_PRESS_TIMEOUT;
    }

    return ESP_ERR_TIMEOUT;
}

/* Derive adaptive thresholds and populate s_calibration_config accordingly. */
static void calibration_derive_adaptive_thresholds(const calibration_signal_stats_t *hall_stats,
                                                   const calibration_signal_stats_t *p0_stats,
                                                   const calibration_signal_stats_t *p1_stats,
                                                   const calibration_signal_stats_t *p2_stats,
                                                   int32_t matched_hall_full,
                                                   int32_t matched_b1_full,
                                                   int32_t matched_b2_full)
{
    if (hall_stats == NULL || p0_stats == NULL || p1_stats == NULL || p2_stats == NULL) return;

    /* Hall baseline and noise */
    s_calibration_config.hall_baseline = hall_stats->mean;
    s_calibration_config.hall_noise_raw = hall_stats->noise_pp;

    /* Pressure baselines and noise */
    s_calibration_config.pressure_0_baseline = p0_stats->mean;
    s_calibration_config.pressure_1_baseline = p1_stats->mean;
    s_calibration_config.pressure_2_baseline = p2_stats->mean;

    s_calibration_config.pressure_0_noise_raw = p0_stats->noise_pp;
    s_calibration_config.pressure_1_noise_raw = p1_stats->noise_pp;
    s_calibration_config.pressure_2_noise_raw = p2_stats->noise_pp;

    /* Captured full-press values */
    s_calibration_config.hall_full_press = matched_hall_full;
    s_calibration_config.bladder_1_full_press = matched_b1_full;
    s_calibration_config.bladder_2_full_press = matched_b2_full;

    /* hall range & direction */
    s_calibration_config.hall_range_raw = calibration_abs_i32(matched_hall_full - s_calibration_config.hall_baseline);
    s_calibration_config.hall_direction = (matched_hall_full > s_calibration_config.hall_baseline) ? 1 : -1;

    int32_t hall_noise_margin = calibration_max_i32(
        s_calibration_config.hall_noise_raw * CALIBRATION_HALL_NOISE_MARGIN_MULTIPLIER,
        20);
    int32_t hall_hysteresis = calibration_max_i32(
        s_calibration_config.hall_noise_raw * 2,
        10);

    s_calibration_config.hall_start_delta = calibration_max_i32((s_calibration_config.hall_range_raw * 15) / 100, hall_noise_margin);
    s_calibration_config.hall_full_delta_threshold = calibration_max_i32((s_calibration_config.hall_range_raw * 85) / 100,
                                                                        s_calibration_config.hall_start_delta + hall_hysteresis);
    if (s_calibration_config.hall_full_delta_threshold > s_calibration_config.hall_range_raw) {
        s_calibration_config.hall_full_delta_threshold = s_calibration_config.hall_range_raw;
    }
    s_calibration_config.hall_recoil_delta = calibration_max_i32(
        (s_calibration_config.hall_range_raw * 10) / 100,
        calibration_max_i32(s_calibration_config.hall_noise_raw * 2, 10));
    if (s_calibration_config.hall_recoil_delta >= s_calibration_config.hall_start_delta) {
        s_calibration_config.hall_recoil_delta =
            calibration_max_i32(1, s_calibration_config.hall_start_delta / 2);
    }
    s_calibration_config.hall_tolerance_raw = calibration_adaptive_hall_tolerance(s_calibration_config.hall_range_raw,
                                                                                  s_calibration_config.hall_noise_raw);

    /* pressure ranges: compute from measured baselines (not host-provided expected values) */
    s_calibration_config.pressure_1_range_raw = calibration_abs_i32(s_calibration_config.bladder_1_full_press - s_calibration_config.pressure_1_baseline);
    s_calibration_config.pressure_2_range_raw = calibration_abs_i32(s_calibration_config.bladder_2_full_press - s_calibration_config.pressure_2_baseline);

    int32_t max_noise = calibration_max_i32(s_calibration_config.pressure_1_noise_raw, s_calibration_config.pressure_2_noise_raw);
    int32_t pressure_contact_min = 100;
    s_calibration_config.pressure_contact_threshold = calibration_max_i32(
        max_noise * CALIBRATION_PRESSURE_CONTACT_NOISE_MULTIPLIER,
        pressure_contact_min);

    /* Use the smaller reliable pressure range for pressure_valid_threshold when both sensors are used */
    int32_t min_range = calibration_max_i32(1, calibration_min_i32(s_calibration_config.pressure_1_range_raw, s_calibration_config.pressure_2_range_raw));
    s_calibration_config.pressure_valid_threshold = calibration_max_i32((min_range * 70) / 100,
                                                                       s_calibration_config.pressure_contact_threshold +
                                                                           calibration_max_i32(max_noise, 1));

    /* sample/window already set in config; record timestamp */
    s_calibration_config.calibrated_at_ms = (int64_t)(esp_timer_get_time() / 1000);

    ESP_LOGI(TAG, "Derived adaptive thresholds: hall_range=%ld start=%ld full=%ld recoil=%ld p1_range=%ld p2_range=%ld p_valid=%ld p_contact=%ld",
             (long)s_calibration_config.hall_range_raw,
             (long)s_calibration_config.hall_start_delta,
             (long)s_calibration_config.hall_full_delta_threshold,
             (long)s_calibration_config.hall_recoil_delta,
             (long)s_calibration_config.pressure_1_range_raw,
             (long)s_calibration_config.pressure_2_range_raw,
             (long)s_calibration_config.pressure_valid_threshold,
             (long)s_calibration_config.pressure_contact_threshold);

}

/* Validate derived adaptive thresholds and return a calibration reason id on failure */
static calibration_reason_id_t calibration_validate_derived_thresholds(void)
{
    const int32_t MIN_HALL_RANGE = 30;
    const int32_t MIN_PRESSURE_RANGE = 300;

    if (s_calibration_config.hall_range_raw < MIN_HALL_RANGE) {
        return CAL_REASON_HALL_RANGE_TOO_SMALL;
    }

    if ((int64_t)s_calibration_config.hall_noise_raw * 4 >= (int64_t)s_calibration_config.hall_range_raw) {
        return CAL_REASON_HALL_NOISE_TOO_HIGH;
    }

    if (s_calibration_config.hall_start_delta <= 0) return CAL_REASON_ADAPTIVE_THRESHOLD_INVALID;
    if (s_calibration_config.hall_full_delta_threshold <= s_calibration_config.hall_start_delta) return CAL_REASON_ADAPTIVE_THRESHOLD_INVALID;
    if (s_calibration_config.hall_full_delta_threshold > s_calibration_config.hall_range_raw) return CAL_REASON_ADAPTIVE_THRESHOLD_INVALID;
    if (s_calibration_config.hall_recoil_delta <= 0) return CAL_REASON_ADAPTIVE_THRESHOLD_INVALID;
    if (s_calibration_config.hall_recoil_delta >= s_calibration_config.hall_start_delta) return CAL_REASON_ADAPTIVE_THRESHOLD_INVALID;

    if (s_calibration_config.pressure_1_range_raw < MIN_PRESSURE_RANGE) return CAL_REASON_PRESSURE_RANGE_TOO_SMALL;
    if (s_calibration_config.pressure_2_range_raw < MIN_PRESSURE_RANGE) return CAL_REASON_PRESSURE_RANGE_TOO_SMALL;

    int32_t max_pressure_noise = calibration_max_i32(s_calibration_config.pressure_1_noise_raw, s_calibration_config.pressure_2_noise_raw);
    int32_t min_pressure_range = calibration_min_i32(
        s_calibration_config.pressure_1_range_raw,
        s_calibration_config.pressure_2_range_raw);
    if ((int64_t)max_pressure_noise * CALIBRATION_PRESSURE_MIN_SNR_MULTIPLIER >=
        (int64_t)min_pressure_range) {
        return CAL_REASON_PRESSURE_NOISE_TOO_HIGH;
    }

    if (s_calibration_config.pressure_valid_threshold <= s_calibration_config.pressure_contact_threshold) return CAL_REASON_ADAPTIVE_THRESHOLD_INVALID;

    if (s_calibration_config.pressure_valid_threshold > min_pressure_range) return CAL_REASON_ADAPTIVE_THRESHOLD_INVALID;

    if (s_calibration_config.pressure_balance_allowed_pct < 5 || s_calibration_config.pressure_balance_allowed_pct > 60) return CAL_REASON_ADAPTIVE_THRESHOLD_INVALID;

    return CAL_REASON_NONE;
}

/* =========================================================
 * Calibration statistics helpers
 * ========================================================= */
static void calibration_stats_init(calibration_signal_stats_t *s)
{
    if (s == NULL) return;
    s->sum = 0;
    s->mean = 0;
    s->min = INT32_MAX;
    s->max = INT32_MIN;
    s->noise_pp = 0;
    s->last = 0;
    s->valid_count = 0;
    memset(s->samples, 0, sizeof(s->samples));
}

static void calibration_stats_update(calibration_signal_stats_t *s, int32_t value)
{
    if (s == NULL) return;
    if (s->valid_count >= CALIBRATION_MAX_STATS_SAMPLES) return;
    s->sum += value;
    s->last = value;
    if (value < s->min) s->min = value;
    if (value > s->max) s->max = value;
    s->samples[s->valid_count] = value;
    s->valid_count++;
}

static void calibration_stats_finalize(calibration_signal_stats_t *s)
{
    if (s == NULL || s->valid_count == 0) return;

    calibration_sort_i32(s->samples, s->valid_count);

    int trim_count = (s->valid_count * CALIBRATION_NOISE_TRIM_PERCENT) / 100;
    if ((s->valid_count - (trim_count * 2)) < 5) {
        trim_count = 0;
    }

    int first = trim_count;
    int last = s->valid_count - trim_count - 1;
    int64_t robust_sum = 0;
    for (int i = first; i <= last; i++) {
        robust_sum += s->samples[i];
    }

    int robust_count = last - first + 1;
    s->mean = (int32_t)(robust_sum / robust_count);

    int64_t robust_span = (int64_t)s->samples[last] - (int64_t)s->samples[first];
    s->noise_pp = robust_span > INT32_MAX ? INT32_MAX : (int32_t)robust_span;
}

static void calibration_sort_i32(int32_t *values, int count)
{
    if (values == NULL || count < 2) return;

    for (int i = 1; i < count; i++) {
        int32_t current = values[i];
        int j = i - 1;
        while (j >= 0 && values[j] > current) {
            values[j + 1] = values[j];
            j--;
        }
        values[j + 1] = current;
    }
}

static int32_t calibration_max_i32(int32_t a, int32_t b)
{
    return a >= b ? a : b;
}

static int32_t calibration_min_i32(int32_t a, int32_t b)
{
    return a <= b ? a : b;
}

static int32_t calibration_abs_i32(int32_t v)
{
    return v < 0 ? -v : v;
}

/* Adaptive tolerance helpers (used during calibration decisions) */
static int32_t calibration_adaptive_pressure_tolerance(int32_t target, int32_t noise_raw)
{
    int32_t pct_tol = (abs(target) * 8) / 100;
    int32_t noise_tol = noise_raw * 5;
    int32_t min_tol = 100;
    int32_t t = calibration_max_i32(min_tol, calibration_max_i32(pct_tol, noise_tol));
    return t;
}

static int32_t calibration_adaptive_hall_tolerance(int32_t hall_range, int32_t noise_raw)
{
    int32_t pct_tol = (abs(hall_range) * 5) / 100;
    int32_t noise_tol = noise_raw * 4;
    int32_t min_tol = 20;
    int32_t t = calibration_max_i32(min_tol, calibration_max_i32(pct_tol, noise_tol));
    return t;
}

static esp_err_t calibration_validate_pressure_triplet(int32_t v0, int32_t v1, int32_t v2)
{
    s_last_hx710_raw[0] = v0;
    s_last_hx710_raw[1] = v1;
    s_last_hx710_raw[2] = v2;

    if (calibration_is_saturated_24bit(v0) ||
        calibration_is_saturated_24bit(v1) ||
        calibration_is_saturated_24bit(v2)) {
        memset(s_hx710_zero_streaks, 0, sizeof(s_hx710_zero_streaks));
        return ESP_ERR_INVALID_RESPONSE;
    }

    int32_t values[3] = {v0, v1, v2};
    for (int i = 0; i < 3; i++) {
        if (values[i] >= -CALIBRATION_STUCK_ZERO_NEAR_ZERO_RAW &&
            values[i] <= CALIBRATION_STUCK_ZERO_NEAR_ZERO_RAW) {
            s_hx710_zero_streaks[i]++;
        } else {
            s_hx710_zero_streaks[i] = 0;
        }

        if (s_hx710_zero_streaks[i] == CALIBRATION_STUCK_ZERO_THRESHOLD_COUNT) {
            if (i == 0) {
                ESP_LOGW(TAG,
                         "pressure_sensor_0 appears stuck or near zero; check DOUT wiring/GPIO%d/HX710 module",
                         (int)BOARD_HX710_0_DOUT);
            } else if (i == 1) {
                ESP_LOGE(TAG,
                         "pressure_sensor_1 appears stuck at zero; check DOUT wiring/GPIO%d/HX710 module",
                         (int)BOARD_HX710_1_DOUT);
            } else {
                ESP_LOGE(TAG,
                         "pressure_sensor_2 appears stuck at zero; check DOUT wiring/GPIO%d/HX710 module",
                         (int)BOARD_HX710_2_DOUT);
            }
        }

        if (i > 0 &&
            s_hx710_zero_streaks[i] >= CALIBRATION_STUCK_ZERO_THRESHOLD_COUNT) {
            return ESP_ERR_INVALID_RESPONSE;
        }
    }

    return ESP_OK;
}

static esp_err_t calibration_read_valid_sample(calibration_sample_t *out_sample)
{
    if (out_sample == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    esp_err_t err = calibration_read_hall_average(&out_sample->hall);
    if (err != ESP_OK) {
        return err;
    }

    err = hx710_read_3_shared_sck(BOARD_HX710_SHARED_SCK,
                                  BOARD_HX710_0_DOUT,
                                  BOARD_HX710_1_DOUT,
                                  BOARD_HX710_2_DOUT,
                                  &out_sample->p0,
                                  &out_sample->p1,
                                  &out_sample->p2);
    if (err != ESP_OK) {
        memset(s_hx710_zero_streaks, 0, sizeof(s_hx710_zero_streaks));
        return err;
    }

    return calibration_validate_pressure_triplet(out_sample->p0,
                                                 out_sample->p1,
                                                 out_sample->p2);
}

/**
 * @brief Read HX710 safely and convert timeout into ESP error.
 */
static esp_err_t calibration_read_pressure_once(gpio_num_t sck_pin,
                                                gpio_num_t dout_pin,
                                                int32_t *out_value)
{
    if (out_value == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    /* sck_pin is unused because shared SCK is used internally */
    (void)sck_pin;

    /* Use shared-SCK synchronized read and select the requested dout pin value */
    int32_t v0 = 0, v1 = 0, v2 = 0;
    esp_err_t err = hx710_read_3_shared_sck(
        BOARD_HX710_SHARED_SCK,
        BOARD_HX710_0_DOUT,
        BOARD_HX710_1_DOUT,
        BOARD_HX710_2_DOUT,
        &v0,
        &v1,
        &v2);

    if (err != ESP_OK) {
        return err;
    }

    /* Log all three raw sensor values (decimal + hex) to make stuck bit patterns visible */
    ESP_LOGD(TAG,
             "p0=%ld hex=0x%06X p1=%ld hex=0x%06X p2=%ld hex=0x%06X",
             (long)v0, (unsigned int)((uint32_t)v0 & 0xFFFFFF),
             (long)v1, (unsigned int)((uint32_t)v1 & 0xFFFFFF),
             (long)v2, (unsigned int)((uint32_t)v2 & 0xFFFFFF));

    err = calibration_validate_pressure_triplet(v0, v1, v2);
    if (err != ESP_OK) {
        return err;
    }

    if (dout_pin == BOARD_HX710_0_DOUT) {
        *out_value = v0;
    } else if (dout_pin == BOARD_HX710_1_DOUT) {
        *out_value = v1;
    } else if (dout_pin == BOARD_HX710_2_DOUT) {
        *out_value = v2;
    } else {
        return ESP_ERR_INVALID_ARG;
    }

    return ESP_OK;
}

/**
 * @brief Read averaged HX710 value to reduce noise.
 *
 * This is still a raw value. We are only averaging several raw reads.
 */
static esp_err_t calibration_read_pressure_average(gpio_num_t sck_pin,
                                                   gpio_num_t dout_pin,
                                                   int32_t *out_value)
{
    if (out_value == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    int64_t sum = 0;

    for (int i = 0; i < CALIBRATION_PRESSURE_AVERAGE_SAMPLE_COUNT; i++) {
        int32_t value = 0;

        esp_err_t err = calibration_read_pressure_once(sck_pin,
                                                       dout_pin,
                                                       &value);
        if (err != ESP_OK) {
            return err;
        }

        sum += value;
        vTaskDelay(pdMS_TO_TICKS(5));
    }

    *out_value = (int32_t)(sum / CALIBRATION_PRESSURE_AVERAGE_SAMPLE_COUNT);

    return ESP_OK;
}

/**
 * @brief Read averaged Hall ADC value.
 *
 * Hall sensor driver only reads raw ADC.
 * Calibration manager decides how to use the raw value.
 */
static esp_err_t calibration_read_hall_average(int32_t *out_value)
{
    if (out_value == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    int64_t sum = 0;

    for (int i = 0; i < CALIBRATION_HALL_AVERAGE_SAMPLE_COUNT; i++) {
        int raw_value = 0;

        esp_err_t err = hall_sensor_read_raw(&s_hall_sensor, &raw_value);
        if (err != ESP_OK) {
            return err;
        }

        sum += raw_value;
        vTaskDelay(pdMS_TO_TICKS(5));
    }

    *out_value = (int32_t)(sum / CALIBRATION_HALL_AVERAGE_SAMPLE_COUNT);

    return ESP_OK;
}

/**
 * @brief Wait until pressure sensor reaches the expected target range.
 */
static esp_err_t calibration_wait_for_pressure_target(const char *label,
                                                      gpio_num_t sck_pin,
                                                      gpio_num_t dout_pin,
                                                      int32_t target_value,
                                                      int32_t tolerance,
                                                      int32_t *matched_value)
{
    if (label == NULL || matched_value == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    int elapsed_ms = 0;

    ESP_LOGI(TAG,
             "Waiting for %s target=%ld tolerance=%ld",
             label,
             (long)target_value,
             (long)tolerance);

    while (s_running && elapsed_ms < CALIBRATION_MAX_WAIT_MS) {
        int32_t current_value = 0;

        esp_err_t err = calibration_read_pressure_average(sck_pin,
                                                          dout_pin,
                                                          &current_value);
        if (err != ESP_OK) {
            ESP_LOGW(TAG,
                     "%s read failed: %s",
                     label,
                     esp_err_to_name(err));

            /* Propagate stuck-zero detection immediately to caller; caller will decide failure mapping */
            if (err == ESP_ERR_INVALID_RESPONSE) {
                return err;
            }

            vTaskDelay(pdMS_TO_TICKS(CALIBRATION_POLL_DELAY_MS));
            elapsed_ms += CALIBRATION_POLL_DELAY_MS;
            continue;
        }

        /* Log current selected value */
        ESP_LOGI(TAG,
                 "%s current=%ld target=%ld",
                 label,
                 (long)current_value,
                 (long)target_value);

        /* Also log the last raw triplet at DEBUG level so hex patterns are available when needed */
        ESP_LOGD(TAG,
                 "p0=%ld hex=0x%06X p1=%ld hex=0x%06X p2=%ld hex=0x%06X",
                 (long)s_last_hx710_raw[0], (unsigned int)((uint32_t)s_last_hx710_raw[0] & 0xFFFFFF),
                 (long)s_last_hx710_raw[1], (unsigned int)((uint32_t)s_last_hx710_raw[1] & 0xFFFFFF),
                 (long)s_last_hx710_raw[2], (unsigned int)((uint32_t)s_last_hx710_raw[2] & 0xFFFFFF));

        if (calibration_is_within_tolerance(current_value,
                                            target_value,
                                            tolerance)) {
            *matched_value = current_value;

            ESP_LOGI(TAG,
                     "%s matched with value=%ld",
                     label,
                     (long)current_value);

            return ESP_OK;
        }

        vTaskDelay(pdMS_TO_TICKS(CALIBRATION_POLL_DELAY_MS));
        elapsed_ms += CALIBRATION_POLL_DELAY_MS;
    }

    if (!s_running) {
        return ESP_ERR_INVALID_STATE;
    }

    ESP_LOGE(TAG, "%s target wait timeout", label);

    return ESP_ERR_TIMEOUT;
}

/**
 * @brief Wait until Hall value reaches calculated full-press target.
 */
static esp_err_t calibration_wait_for_hall_target(int32_t target_value,
                                                  int32_t tolerance,
                                                  int32_t *matched_value)
{
    if (matched_value == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    int elapsed_ms = 0;

    ESP_LOGI(TAG,
             "Waiting for Hall target=%ld tolerance=%ld",
             (long)target_value,
             (long)tolerance);

    while (s_running && elapsed_ms < CALIBRATION_MAX_WAIT_MS) {
        int32_t current_value = 0;

        esp_err_t err = calibration_read_hall_average(&current_value);
        if (err != ESP_OK) {
            ESP_LOGW(TAG,
                     "Hall read failed: %s",
                     esp_err_to_name(err));

            vTaskDelay(pdMS_TO_TICKS(CALIBRATION_POLL_DELAY_MS));
            elapsed_ms += CALIBRATION_POLL_DELAY_MS;
            continue;
        }

        ESP_LOGI(TAG,
                 "Hall current=%ld target=%ld",
                 (long)current_value,
                 (long)target_value);

        if (calibration_is_within_tolerance(current_value,
                                            target_value,
                                            tolerance)) {
            *matched_value = current_value;

            ESP_LOGI(TAG,
                     "Hall target matched with value=%ld",
                     (long)current_value);

            return ESP_OK;
        }

        vTaskDelay(pdMS_TO_TICKS(CALIBRATION_POLL_DELAY_MS));
        elapsed_ms += CALIBRATION_POLL_DELAY_MS;
    }

    if (!s_running) {
        return ESP_ERR_INVALID_STATE;
    }

    ESP_LOGE(TAG, "Hall target wait timeout");

    return ESP_ERR_TIMEOUT;
}

/**
 * @brief Mark calibration as failed and update indicator.
 */
static void calibration_manager_fail(calibration_reason_id_t reason_id)
{
    s_last_failure_reason = reason_id;
    s_last_failure_action = calibration_codes_default_action_for_reason(reason_id);

    ESP_LOGE(TAG,
             "Calibration failed reason_id=%d reason=%s action_id=%d action=%s",
             (int)s_last_failure_reason,
             calibration_codes_reason_to_string(s_last_failure_reason),
             (int)s_last_failure_action,
             calibration_codes_action_to_string(s_last_failure_action));

    s_calibration_config.calibrated = false;

    status_indicator_set_state(RESQ_STATE_CALIBRATION_FAIL);

    publish_calibration_progress(s_last_failure_reason,
                                 RESQ_STATE_CALIBRATION_FAIL,
                                 s_last_failure_action);
}

/**
 * @brief Mark calibration as successful, save config, and update indicator.
 */
static esp_err_t calibration_manager_save_success(void)
{
    if (!calibration_config_validate(&s_calibration_config)) {
        calibration_manager_fail(CAL_REASON_CALIBRATION_VALUES_OUT_OF_RANGE);
        return ESP_ERR_INVALID_STATE;
    }

    esp_err_t err = config_store_save_calibration(&s_calibration_config);
    if (err != ESP_OK) {
        calibration_manager_fail(CAL_REASON_NVS_SAVE_FAILED);
        return err;
    }

    status_indicator_set_state(RESQ_STATE_READY_FOR_SESSION);

    ESP_LOGI(TAG, "Calibration completed and saved successfully");

    return ESP_OK;
}

/* =========================================================
 * Main calibration task
 * ========================================================= */

/**
 * @brief Calibration state flow task.
 *
 * Flow:
 * 1. Wait until pressure sensor 0 matches ref_pressure.
 * 2. Wait until pressure sensor 1 matches bladder_1_pressure.
 * 3. Wait until pressure sensor 2 matches bladder_2_pressure.
 * 4. Capture hall_baseline.
 * 5. Calculate hall_full_press = hall_baseline - hall_delta.
 * 6. Wait until Hall reading reaches hall_full_press.
 * 7. Capture bladder_1_full_press and bladder_2_full_press.
 * 8. Validate and save calibration config.
 */
static void calibration_manager_task(void *arg)
{
    (void)arg;

    ESP_LOGI(TAG, "Calibration task started");

    status_indicator_set_state(RESQ_STATE_CALIBRATING);

    publish_calibration_progress(CAL_REASON_NONE,
                                 RESQ_STATE_CALIBRATING,
                                 CAL_ACTION_NONE);

    int32_t matched_ref_pressure = 0;
    int32_t matched_bladder_1_pressure = 0;
    int32_t matched_bladder_2_pressure = 0;

    /* -----------------------------------------------------
     * Step 1: Allow settling, then collect rest statistics first
     * (hall + all pressures at rest)
     * ----------------------------------------------------- */
    calibration_signal_stats_t hall_stats, p0_stats, p1_stats, p2_stats;

    ESP_LOGI(TAG, "Calibration baseline settling: release chest and keep manikin still");
    publish_calibration_progress(CAL_REASON_NONE,
                                 RESQ_STATE_CALIBRATING,
                                 CAL_ACTION_WAIT_OR_CANCEL);

    vTaskDelay(pdMS_TO_TICKS(2000));

    if (!s_running) {
        goto task_exit;
    }

    esp_err_t err = calibration_collect_rest_stats(&hall_stats, &p0_stats, &p1_stats, &p2_stats);
    if (err != ESP_OK) {
        if (!s_running) {
            goto task_exit;
        }
        ESP_LOGE(TAG, "Failed to collect rest stats: %s", esp_err_to_name(err));
        calibration_manager_fail(CAL_REASON_SENSOR_STUCK_OR_NOISE);
        goto task_exit;
    }

    /* Store measured baselines and noise */
    s_calibration_config.hall_baseline = hall_stats.mean;
    s_calibration_config.hall_noise_raw = hall_stats.noise_pp;

    s_calibration_config.pressure_0_baseline = p0_stats.mean;
    s_calibration_config.pressure_1_baseline = p1_stats.mean;
    s_calibration_config.pressure_2_baseline = p2_stats.mean;

    s_calibration_config.pressure_0_noise_raw = p0_stats.noise_pp;
    s_calibration_config.pressure_1_noise_raw = p1_stats.noise_pp;
    s_calibration_config.pressure_2_noise_raw = p2_stats.noise_pp;

    ESP_LOGI(TAG,
             "Rest stats (trimmed): hall_mean=%ld noise=%ld raw_span=%ld "
             "p0_mean=%ld noise=%ld raw_span=%ld "
             "p1_mean=%ld noise=%ld raw_span=%ld "
             "p2_mean=%ld noise=%ld raw_span=%ld",
             (long)hall_stats.mean,
             (long)hall_stats.noise_pp,
             (long)((int64_t)hall_stats.max - hall_stats.min),
             (long)p0_stats.mean,
             (long)p0_stats.noise_pp,
             (long)((int64_t)p0_stats.max - p0_stats.min),
             (long)p1_stats.mean,
             (long)p1_stats.noise_pp,
             (long)((int64_t)p1_stats.max - p1_stats.min),
             (long)p2_stats.mean,
             (long)p2_stats.noise_pp,
             (long)((int64_t)p2_stats.max - p2_stats.min));

    /* Pressure health validation for rest stats: map to specific reasons */
    calibration_reason_id_t pressure_health_reason =
        calibration_validate_pressure_rest_health(&p0_stats, &p1_stats, &p2_stats);

    if (pressure_health_reason != CAL_REASON_NONE) {
        calibration_manager_fail(pressure_health_reason);
        goto task_exit;
    }

    /* Hall rest stability checks (direction-safe, reason-correct) */
    int32_t expected_hall_delta = calibration_abs_i32(s_calibration_config.hall_delta);
    if (expected_hall_delta < CALIBRATION_HALL_DELTA_MIN_RAW ||
        expected_hall_delta > CALIBRATION_HALL_ADC_MAX_RAW) {
        calibration_manager_fail(CAL_REASON_INVALID_HALL_DELTA);
        goto task_exit;
    }

    if ((int64_t)s_calibration_config.hall_noise_raw * 5 >= (int64_t)expected_hall_delta) {
        calibration_manager_fail(CAL_REASON_HALL_NOISE_TOO_HIGH);
        goto task_exit;
    }

    /* -----------------------------------------------------
     * Step 2: Ensure pressure baselines match host targets (use adaptive tolerance)
     * If baseline is not within tolerance, wait for the operator to adjust target.
     * ----------------------------------------------------- */
    int32_t tol0 = calibration_adaptive_pressure_tolerance(s_calibration_config.ref_pressure, p0_stats.noise_pp);
    if (calibration_is_within_tolerance(s_calibration_config.pressure_0_baseline, s_calibration_config.ref_pressure, tol0)) {
        matched_ref_pressure = s_calibration_config.pressure_0_baseline;
    } else {
        ESP_LOGW(TAG, "Ref pressure baseline not within tolerance, proceeding without waiting: baseline=%ld target=%ld tol=%ld",
                 (long)s_calibration_config.pressure_0_baseline,
                 (long)s_calibration_config.ref_pressure,
                 (long)tol0);
        /* Proceed using observed baseline to avoid blocking full-press detection */
        matched_ref_pressure = s_calibration_config.pressure_0_baseline;
    }

    int32_t tol1 = calibration_adaptive_pressure_tolerance(s_calibration_config.bladder_1_pressure, p1_stats.noise_pp);
    if (calibration_is_within_tolerance(s_calibration_config.pressure_1_baseline, s_calibration_config.bladder_1_pressure, tol1)) {
        matched_bladder_1_pressure = s_calibration_config.pressure_1_baseline;
    } else {
        ESP_LOGW(TAG, "Bladder 1 baseline not within tolerance, proceeding without waiting: baseline=%ld target=%ld tol=%ld",
                 (long)s_calibration_config.pressure_1_baseline,
                 (long)s_calibration_config.bladder_1_pressure,
                 (long)tol1);
        matched_bladder_1_pressure = s_calibration_config.pressure_1_baseline;
    }

    int32_t tol2 = calibration_adaptive_pressure_tolerance(s_calibration_config.bladder_2_pressure, p2_stats.noise_pp);
    if (calibration_is_within_tolerance(s_calibration_config.pressure_2_baseline, s_calibration_config.bladder_2_pressure, tol2)) {
        matched_bladder_2_pressure = s_calibration_config.pressure_2_baseline;
    } else {
        ESP_LOGW(TAG, "Bladder 2 baseline not within tolerance, proceeding without waiting: baseline=%ld target=%ld tol=%ld",
                 (long)s_calibration_config.pressure_2_baseline,
                 (long)s_calibration_config.bladder_2_pressure,
                 (long)tol2);
        matched_bladder_2_pressure = s_calibration_config.pressure_2_baseline;
    }

    /* Persist matched bladder targets (observed values) */
    s_calibration_config.ref_pressure = matched_ref_pressure;
    s_calibration_config.bladder_1_pressure = matched_bladder_1_pressure;
    s_calibration_config.bladder_2_pressure = matched_bladder_2_pressure;

    /* -----------------------------------------------------
     * Step 6: Collect full-press stats (adaptive, direction-safe)
     * ----------------------------------------------------- */
    int32_t matched_hall_full = 0;
    int32_t matched_b1_full = 0;
    int32_t matched_b2_full = 0;
    calibration_reason_id_t hall_failure_reason = CAL_REASON_NONE;

    /* Publish progress and prompt operator before waiting for full press */
    publish_calibration_progress(CAL_REASON_NONE,
                                 RESQ_STATE_CALIBRATING,
                                 CAL_ACTION_WAIT_OR_CANCEL);
    ESP_LOGI(TAG, "Waiting for Hall full press: ask operator to press and hold full compression now");

    err = calibration_collect_full_press_stats(s_calibration_config.hall_delta,
                                               &matched_hall_full,
                                               &matched_b1_full,
                                               &matched_b2_full,
                                               &hall_stats,
                                               &hall_failure_reason);

    if (err != ESP_OK) {
        if (hall_failure_reason != CAL_REASON_NONE) {
            calibration_manager_fail(hall_failure_reason);
        } else if (err == ESP_ERR_INVALID_ARG) {
            calibration_manager_fail(CAL_REASON_INVALID_HALL_DELTA);
        } else if (err == ESP_ERR_TIMEOUT) {
            calibration_manager_fail(CAL_REASON_HALL_FULL_PRESS_TIMEOUT);
        } else {
            calibration_manager_fail(CAL_REASON_FULL_PRESS_PRESSURE_READ_FAILED);
        }
        goto task_exit;
    }

    ESP_LOGI(TAG, "Captured full-press: hall=%ld b1=%ld b2=%ld",
             (long)matched_hall_full, (long)matched_b1_full, (long)matched_b2_full);

    /* Derive adaptive thresholds and store in s_calibration_config */
    calibration_derive_adaptive_thresholds(&hall_stats, &p0_stats, &p1_stats, &p2_stats,
                                           matched_hall_full, matched_b1_full, matched_b2_full);

    /* Validate derived adaptive thresholds and fail with a specific reason if invalid */
    calibration_reason_id_t vreason = calibration_validate_derived_thresholds();
    if (vreason != CAL_REASON_NONE) {
        calibration_manager_fail(vreason);
        goto task_exit;
    }

    /* Final save */
    s_calibration_config.calibrated = true;

    err = calibration_manager_save_success();
    if (err != ESP_OK) {
        goto task_exit;
    }

    publish_calibration_progress(CAL_REASON_NONE,
                                 RESQ_STATE_CALIBRATING,
                                 CAL_ACTION_NONE);

task_exit:
    ESP_LOGI(TAG, "Calibration task ended");

    s_running = false;
    s_calibration_task_handle = NULL;

    vTaskDelete(NULL);
}

/* =========================================================
 * Public API implementation
 * ========================================================= */

esp_err_t calibration_manager_init(void)
{
    if (s_initialized) {
        return ESP_OK;
    }

    calibration_config_set_defaults(&s_calibration_config);

    /* Initialize pressure sensor 0 (shared SCK) */
    esp_err_t err = hx710_init(BOARD_HX710_SHARED_SCK,
                               BOARD_HX710_0_DOUT);
    if (err != ESP_OK) {
        ESP_LOGE(TAG,
                 "Failed to init pressure sensor 0: %s",
                 esp_err_to_name(err));
        return err;
    }

    /* Initialize pressure sensor 1 (shared SCK) */
    err = hx710_init(BOARD_HX710_SHARED_SCK,
                     BOARD_HX710_1_DOUT);
    if (err != ESP_OK) {
        ESP_LOGE(TAG,
                 "Failed to init pressure sensor 1: %s",
                 esp_err_to_name(err));
        return err;
    }

    /* Initialize pressure sensor 2 (shared SCK) */
    err = hx710_init(BOARD_HX710_SHARED_SCK,
                     BOARD_HX710_2_DOUT);
    if (err != ESP_OK) {
        ESP_LOGE(TAG,
                 "Failed to init pressure sensor 2: %s",
                 esp_err_to_name(err));
        return err;
    }

    /* Initialize Hall sensor raw ADC driver */
    err = hall_sensor_init(&s_hall_sensor,
                           BOARD_HALL_ADC_CHAN );
    if (err != ESP_OK) {
        ESP_LOGE(TAG,
                 "Failed to init Hall sensor: %s",
                 esp_err_to_name(err));
        return err;
    }

    /*
     * Try loading previously saved calibration.
     * If not found, config remains default and calibrated=false.
     */
    err = config_store_load_calibration(&s_calibration_config);
    if (err != ESP_OK) {
        ESP_LOGW(TAG,
                 "Failed to load saved calibration: %s",
                 esp_err_to_name(err));

        calibration_config_set_defaults(&s_calibration_config);
    }

    s_initialized = true;
    s_running = false;

    ESP_LOGI(TAG, "Calibration manager initialized");

    return ESP_OK;
}

esp_err_t calibration_manager_start(const network_config_t *network_config,
                                    const calibration_config_t *host_params,
                                    const char *command_id)
{

    if (!s_initialized) {
        return ESP_ERR_INVALID_STATE;
    }

    if (network_config == NULL || host_params == NULL || command_id == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (s_running || s_calibration_task_handle != NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    /*
     * Host must provide these target values:
     * - ref_pressure
     * - bladder_1_pressure
     * - bladder_2_pressure
     * - hall_delta
     */
    if (host_params->ref_pressure <= 0 ||
        host_params->bladder_1_pressure <= 0 ||
        host_params->bladder_2_pressure <= 0 ||
        host_params->hall_delta < CALIBRATION_HALL_DELTA_MIN_RAW ||
        host_params->hall_delta > CALIBRATION_HALL_ADC_MAX_RAW) {

        ESP_LOGE(TAG, "Invalid host calibration parameters");
        return ESP_ERR_INVALID_ARG;
    }

    /* Start from firmware defaults, then copy only host-controlled fields. */
    calibration_config_set_defaults(&s_calibration_config);

    s_calibration_config.ref_pressure = host_params->ref_pressure;
    s_calibration_config.bladder_1_pressure = host_params->bladder_1_pressure;
    s_calibration_config.bladder_2_pressure = host_params->bladder_2_pressure;
    s_calibration_config.hall_delta = host_params->hall_delta;

    if (host_params->profile_id[0] != '\0') {
        strncpy(s_calibration_config.profile_id,
                host_params->profile_id,
                sizeof(s_calibration_config.profile_id) - 1);
        s_calibration_config.profile_id[sizeof(s_calibration_config.profile_id) - 1] = '\0';
    }
    if (host_params->pressure_balance_allowed_pct >= 5 &&
        host_params->pressure_balance_allowed_pct <= 60) {
        s_calibration_config.pressure_balance_allowed_pct =
            host_params->pressure_balance_allowed_pct;
    }
    if (host_params->calibration_sample_count > 0) {
        s_calibration_config.calibration_sample_count =
            calibration_min_i32(host_params->calibration_sample_count,
                                CALIBRATION_MAX_STATS_SAMPLES);
    }
    if (host_params->calibration_window_ms > 0) {
        s_calibration_config.calibration_window_ms =
            host_params->calibration_window_ms;
    }

    /* save host params so BUTTON_1 retry can reuse them */
    memcpy(&s_last_host_params, host_params, sizeof(s_last_host_params));
    s_has_last_host_params = true;
    s_last_failure_reason = CAL_REASON_NONE;
    s_last_failure_action = CAL_ACTION_NONE;

    /* copy network config and command id into static state for progress publishing */
    memcpy(&s_network_config, network_config, sizeof(network_config_t));
    strncpy(s_command_id, command_id, sizeof(s_command_id) - 1);
    s_command_id[sizeof(s_command_id) - 1] = '\0';

    /* Reset diagnostic arrays for this calibration run */
    memset(s_hx710_zero_streaks, 0, sizeof(s_hx710_zero_streaks));
    memset(s_last_hx710_raw, 0, sizeof(s_last_hx710_raw));

    /* Debug: log the received host calibration payload values */
    ESP_LOGI(TAG, "Calibration payload: hall_delta=%ld ref_pressure=%ld bladder_1=%ld bladder_2=%ld balance_pct=%d",
             (long)s_calibration_config.hall_delta,
             (long)s_calibration_config.ref_pressure,
             (long)s_calibration_config.bladder_1_pressure,
             (long)s_calibration_config.bladder_2_pressure,
             s_calibration_config.pressure_balance_allowed_pct);

    s_running = true;

    BaseType_t task_result = xTaskCreate(
        calibration_manager_task,
        "calibration_manager",
        CALIBRATION_TASK_STACK_SIZE,
        NULL,
        CALIBRATION_TASK_PRIORITY,
        &s_calibration_task_handle);

    if (task_result != pdPASS) {
        s_running = false;
        s_calibration_task_handle = NULL;
        return ESP_FAIL;
    }

    ESP_LOGI(TAG, "Calibration started");

    return ESP_OK;
}

esp_err_t calibration_manager_cancel(void)
{
    if (!s_running) {
        return ESP_OK;
    }

    ESP_LOGW(TAG, "Calibration cancel requested");

    /*
     * The task checks s_running inside wait loops.
     * It will exit safely on its own.
     */
    s_running = false;

    s_calibration_config.calibrated = false;

    status_indicator_set_state(RESQ_STATE_PAIRED_IDLE);

    return ESP_OK;
}

bool calibration_manager_is_running(void)
{
    return s_calibration_task_handle != NULL;
}

bool calibration_manager_is_ready(void)
{
    return s_calibration_config.calibrated;
}

esp_err_t calibration_manager_get_config(calibration_config_t *out_config)
{
    if (out_config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    memcpy(out_config,
           &s_calibration_config,
           sizeof(calibration_config_t));

    return ESP_OK;
}

const char *calibration_manager_get_command_id(void)
{
    return s_command_id;
}

calibration_reason_id_t calibration_manager_get_last_failure_reason(void)
{
    return s_last_failure_reason;
}

calibration_action_id_t calibration_manager_get_last_failure_action(void)
{
    return s_last_failure_action;
}

esp_err_t calibration_manager_get_last_host_params(calibration_config_t *out_config)
{
    if (out_config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (!s_has_last_host_params) {
        return ESP_ERR_NOT_FOUND;
    }

    memcpy(out_config, &s_last_host_params, sizeof(calibration_config_t));
    return ESP_OK;
}

esp_err_t calibration_manager_drop_temporary_values(void)
{
    esp_err_t err = config_store_load_calibration(&s_calibration_config);
    if (err != ESP_OK) {
        calibration_config_set_defaults(&s_calibration_config);
    }

    return ESP_OK;
}

esp_err_t calibration_manager_retry_last(network_config_t *network_config)
{
    if (network_config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (!s_has_last_host_params) {
        return ESP_ERR_NOT_FOUND;
    }

    if (s_running || s_calibration_task_handle != NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    const char *cmd_id = s_command_id[0] ? s_command_id : "button/retry";

    return calibration_manager_start(network_config, &s_last_host_params, cmd_id);
}

esp_err_t calibration_manager_publish_progress_event(calibration_reason_id_t reason_id,
                                                     resq_state_t state,
                                                     calibration_action_id_t action_id)
{
    publish_calibration_progress(reason_id, state, action_id);
    return ESP_OK;
}

esp_err_t calibration_manager_parse_start_payload(const char *payload,
                                                  calibration_config_t *out_config,
                                                  char *out_command_id,
                                                  size_t out_command_id_len,
                                                  calibration_reason_id_t *out_reason)
{
    if (out_reason != NULL) {
        *out_reason = CAL_REASON_NONE;
    }

    if (payload == NULL || out_config == NULL) {
        if (out_reason != NULL) {
            *out_reason = CAL_REASON_INVALID_CALIBRATION_PAYLOAD;
        }
        return ESP_ERR_INVALID_ARG;
    }

    calibration_config_set_defaults(out_config);

    if (out_command_id != NULL && out_command_id_len > 0) {
        out_command_id[0] = '\0';
    }

    cJSON *root = cJSON_Parse(payload);
    if (root == NULL) {
        if (out_reason != NULL) {
            *out_reason = CAL_REASON_INVALID_CALIBRATION_PAYLOAD;
        }
        return ESP_FAIL;
    }

    esp_err_t result = ESP_OK;

    /* Prefer request_id, fall back to command_id for compatibility */
    cJSON *command_id = cJSON_GetObjectItemCaseSensitive(root, "request_id");
    if (!cJSON_IsString(command_id) || command_id->valuestring == NULL) {
        command_id = cJSON_GetObjectItemCaseSensitive(root, "command_id");
    }
    cJSON *hall_delta = cJSON_GetObjectItemCaseSensitive(root, "hall_delta");
    cJSON *ref_pressure = cJSON_GetObjectItemCaseSensitive(root, "ref_pressure");
    cJSON *bladder_1_pressure = cJSON_GetObjectItemCaseSensitive(root, "bladder_1_pressure");
    cJSON *bladder_2_pressure = cJSON_GetObjectItemCaseSensitive(root, "bladder_2_pressure");
    cJSON *profile_id = cJSON_GetObjectItemCaseSensitive(root, "profile_id");
    cJSON *pressure_balance_allowed_pct = cJSON_GetObjectItemCaseSensitive(root, "pressure_balance_allowed_pct");

    /* Require either request_id (preferred) or legacy command_id, and numeric fields. */
    if ((!cJSON_IsString(command_id) || command_id->valuestring == NULL) ||
        !cJSON_IsNumber(hall_delta) ||
        !cJSON_IsNumber(ref_pressure) ||
        !cJSON_IsNumber(bladder_1_pressure) ||
        !cJSON_IsNumber(bladder_2_pressure)) {
        if (out_reason != NULL) {
            *out_reason = CAL_REASON_INVALID_CALIBRATION_PAYLOAD;
        }
        result = ESP_ERR_INVALID_ARG;
        goto exit;
    }

    if (hall_delta->valuedouble < CALIBRATION_HALL_DELTA_MIN_RAW ||
        hall_delta->valuedouble > CALIBRATION_HALL_ADC_MAX_RAW) {
        if (out_reason != NULL) {
            *out_reason = CAL_REASON_INVALID_HALL_DELTA;
        }
        result = ESP_ERR_INVALID_ARG;
        goto exit;
    }

    if (ref_pressure->valuedouble <= 0 ||
        bladder_1_pressure->valuedouble <= 0 ||
        bladder_2_pressure->valuedouble <= 0) {
        if (out_reason != NULL) {
            *out_reason = CAL_REASON_INVALID_CALIBRATION_PAYLOAD;
        }
        result = ESP_ERR_INVALID_ARG;
        goto exit;
    }

    if (out_command_id != NULL && out_command_id_len > 0) {
        strncpy(out_command_id, command_id->valuestring, out_command_id_len - 1);
        out_command_id[out_command_id_len - 1] = '\0';
    }

    out_config->hall_delta = (int32_t)hall_delta->valuedouble;
    out_config->ref_pressure = (int32_t)ref_pressure->valuedouble;
    out_config->bladder_1_pressure = (int32_t)bladder_1_pressure->valuedouble;
    out_config->bladder_2_pressure = (int32_t)bladder_2_pressure->valuedouble;
    out_config->calibrated = false;

    if (cJSON_IsString(profile_id) && profile_id->valuestring != NULL) {
        strncpy(out_config->profile_id, profile_id->valuestring, sizeof(out_config->profile_id) - 1);
        out_config->profile_id[sizeof(out_config->profile_id) - 1] = '\0';
    }

    if (cJSON_IsNumber(pressure_balance_allowed_pct)) {
        int32_t pct = (int32_t)pressure_balance_allowed_pct->valuedouble;
        if (pct >= 5 && pct <= 60) {
            out_config->pressure_balance_allowed_pct = pct;
        }
    }

exit:
    cJSON_Delete(root);
    return result;
}

esp_err_t calibration_manager_publish_calibration_result(const char *reply_id,
                                                        const char *status,
                                                        const char *result,
                                                        calibration_reason_id_t reason_id,
                                                        resq_state_t state,
                                                        calibration_action_id_t action_id)
{
    if (reply_id == NULL || reply_id[0] == '\0') {
        return ESP_ERR_INVALID_ARG;
    }

    int event_id = 4000;
    if (result != NULL && (strcmp(result, "PASS") == 0 || strcmp(result, "FAIL") == 0 || strcmp(result, "CANCELLED") == 0)) {
        event_id = 4002;
    }

    char payload[1024];
    if (result != NULL && strcmp(result, "PASS") == 0) {
        int written = snprintf(payload,
                               sizeof(payload),
                               "{"
                               "\"event_id\":%d," 
                               "\"reply_id\":\"%s\"," 
                               "\"status\":\"%s\"," 
                               "\"result\":\"%s\"," 
                               "\"reason_id\":%d," 
                               "\"state\":\"%s\"," 
                               "\"action_id\":%d," 
                               "\"hall_baseline\":%d," 
                               "\"hall_full_press\":%d," 
                               "\"hall_range_raw\":%d," 
                               "\"hall_start_delta\":%d," 
                               "\"hall_full_delta_threshold\":%d," 
                               "\"hall_recoil_delta\":%d," 
                               "\"pressure_1_range_raw\":%d," 
                               "\"pressure_2_range_raw\":%d," 
                               "\"pressure_contact_threshold\":%d," 
                               "\"pressure_valid_threshold\":%d," 
                               "\"pressure_balance_allowed_pct\":%d," 
                               "\"ts_ms\":%lld"
                               "}",
                               event_id,
                               reply_id,
                               status != NULL ? status : "",
                               result != NULL ? result : "",
                               (int)reason_id,
                               resq_state_to_string(state),
                               (int)action_id,
                               (int)s_calibration_config.hall_baseline,
                               (int)s_calibration_config.hall_full_press,
                               (int)s_calibration_config.hall_range_raw,
                               (int)s_calibration_config.hall_start_delta,
                               (int)s_calibration_config.hall_full_delta_threshold,
                               (int)s_calibration_config.hall_recoil_delta,
                               (int)s_calibration_config.pressure_1_range_raw,
                               (int)s_calibration_config.pressure_2_range_raw,
                               (int)s_calibration_config.pressure_contact_threshold,
                               (int)s_calibration_config.pressure_valid_threshold,
                               (int)s_calibration_config.pressure_balance_allowed_pct,
                               (long long)(esp_timer_get_time() / 1000));

        if (written <= 0 || written >= (int)sizeof(payload)) {
            return ESP_ERR_INVALID_SIZE;
        }

        if (!mqtt_manager_is_connected()) {
            return ESP_ERR_INVALID_STATE;
        }

        return mqtt_manager_publish_topic_json(RESQ_SUFFIX_EVENTS_CALIBRATION, payload);
    } else {
        int written = snprintf(payload,
                               sizeof(payload),
                               "{"
                               "\"event_id\":%d," 
                               "\"reply_id\":\"%s\"," 
                               "\"status\":\"%s\"," 
                               "\"result\":\"%s\"," 
                               "\"reason_id\":%d," 
                               "\"state\":\"%s\"," 
                               "\"action_id\":%d," 
                               "\"ts_ms\":%lld"
                               "}",
                               event_id,
                               reply_id,
                               status != NULL ? status : "",
                               result != NULL ? result : "",
                               (int)reason_id,
                               resq_state_to_string(state),
                               (int)action_id,
                               (long long)(esp_timer_get_time() / 1000));

        if (written <= 0 || written >= (int)sizeof(payload)) {
            return ESP_ERR_INVALID_SIZE;
        }

        if (!mqtt_manager_is_connected()) {
            return ESP_ERR_INVALID_STATE;
        }

        return mqtt_manager_publish_topic_json(RESQ_SUFFIX_EVENTS_CALIBRATION, payload);
    }

    
}

/* Read all three HX710 sensors and average them together in a synchronized way. */
static esp_err_t calibration_read_three_pressure_average(int32_t *out_v0, int32_t *out_v1, int32_t *out_v2)
{
    if (out_v0 == NULL || out_v1 == NULL || out_v2 == NULL) return ESP_ERR_INVALID_ARG;

    int64_t sum0 = 0, sum1 = 0, sum2 = 0;

    for (int i = 0; i < CALIBRATION_PRESSURE_AVERAGE_SAMPLE_COUNT; i++) {
        int32_t v0 = 0, v1 = 0, v2 = 0;
        esp_err_t err = hx710_read_3_shared_sck(
            BOARD_HX710_SHARED_SCK,
            BOARD_HX710_0_DOUT,
            BOARD_HX710_1_DOUT,
            BOARD_HX710_2_DOUT,
            &v0, &v1, &v2);
        if (err != ESP_OK) return err;

        sum0 += v0;
        sum1 += v1;
        sum2 += v2;

        vTaskDelay(pdMS_TO_TICKS(5));
    }

    *out_v0 = (int32_t)(sum0 / CALIBRATION_PRESSURE_AVERAGE_SAMPLE_COUNT);
    *out_v1 = (int32_t)(sum1 / CALIBRATION_PRESSURE_AVERAGE_SAMPLE_COUNT);
    *out_v2 = (int32_t)(sum2 / CALIBRATION_PRESSURE_AVERAGE_SAMPLE_COUNT);

    return ESP_OK;
}

/* Validate pressure sensors at rest and return a meaningful calibration reason on failure */
static calibration_reason_id_t calibration_validate_pressure_rest_health(
    const calibration_signal_stats_t *p0,
    const calibration_signal_stats_t *p1,
    const calibration_signal_stats_t *p2)
{
    if (!p0 || !p1 || !p2) {
        return CAL_REASON_SENSOR_STUCK_OR_NOISE;
    }

    /* Full-scale or near full-scale readings usually mean saturation or floating DOUT */
    if (calibration_is_saturated_24bit(p0->mean) ||
        calibration_is_saturated_24bit(p1->mean) ||
        calibration_is_saturated_24bit(p2->mean)) {
        return CAL_REASON_PRESSURE_SENSOR_SATURATED;
    }

    /*
     * Pressure noise is validated against the measured full-press range later.
     * Raw-unit limits here are sensor-specific and previously caused a single
     * transient sample to reject an otherwise stable calibration.
     */
    return CAL_REASON_NONE;
}
