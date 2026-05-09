#include "calibration_manager.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "esp_log.h"
#include "esp_timer.h"

#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include "sensor_runtime.h"

#define CAL_SAMPLE_INTERVAL_MS 50
#define CAL_DEFAULT_WINDOW_MS  500
#define CAL_MAX_WINDOW_MS      1500

static const char *TAG = "calibration_manager";

static SemaphoreHandle_t s_cal_mutex = NULL;
static device_config_t s_cfg;
static calibration_report_t s_report;

/*
 * This helper matches your current telemetry_publisher.c style:
 *
 * sensor_snapshot_t snap;
 * if (sensor_runtime_get_latest(&snap) == ESP_OK) { ... }
 */

typedef struct {
    int32_t force1_avg;
    int32_t force2_avg;
    int32_t hall_avg;
    int32_t hall_min;
    int32_t hall_max;
    int32_t current_delta_avg;
    uint32_t sample_count;
} calibration_sample_window_t;

static uint64_t now_ms(void)
{
    return (uint64_t)(esp_timer_get_time() / 1000ULL);
}

static int32_t abs_i32(int32_t value)
{
    return value < 0 ? -value : value;
}

static float abs_pct_diff_i32(int32_t expected, int32_t actual)
{
    if (expected == 0) {
        return actual == 0 ? 0.0f : 100.0f;
    }

    float diff = fabsf((float)actual - (float)expected);
    return (diff / fabsf((float)expected)) * 100.0f;
}

static float pressure_imbalance_pct(int32_t force1, int32_t force2)
{
    int32_t total = abs_i32(force1) + abs_i32(force2);

    if (total <= 0) {
        return 100.0f;
    }

    return ((float)abs_i32(force1 - force2) / (float)total) * 100.0f;
}

static int calibration_window_ms(void)
{
    int window_ms = s_cfg.calibration_window_ms;

    if (window_ms <= 0) {
        window_ms = CAL_DEFAULT_WINDOW_MS;
    }

    /*
     * Important:
     * This function may currently be called from command_handler.
     * Until we add a proper command task, keep the blocking window bounded.
     */
    if (window_ms > CAL_MAX_WINDOW_MS) {
        window_ms = CAL_MAX_WINDOW_MS;
    }

    return window_ms;
}

static esp_err_t collect_sample_window(calibration_sample_window_t *out)
{
    if (out == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    memset(out, 0, sizeof(*out));

    int window_ms = calibration_window_ms();
    int64_t start_ms = (int64_t)now_ms();

    int64_t force1_sum = 0;
    int64_t force2_sum = 0;
    int64_t hall_sum = 0;
    int64_t delta_sum = 0;

    int32_t hall_min = 0;
    int32_t hall_max = 0;

    uint32_t count = 0;

    while (((int64_t)now_ms() - start_ms) < window_ms) {
        sensor_snapshot_t snap;

        esp_err_t err = sensor_runtime_get_latest(&snap);

        if (err == ESP_OK) {
            force1_sum += snap.force1;
            force2_sum += snap.force2;
            hall_sum += snap.hall_raw;
            delta_sum += snap.current_delta;

            if (count == 0) {
                hall_min = snap.hall_raw;
                hall_max = snap.hall_raw;
            } else {
                if (snap.hall_raw < hall_min) {
                    hall_min = snap.hall_raw;
                }

                if (snap.hall_raw > hall_max) {
                    hall_max = snap.hall_raw;
                }
            }

            count++;
        }

        vTaskDelay(pdMS_TO_TICKS(CAL_SAMPLE_INTERVAL_MS));
    }

    if (count == 0) {
        ESP_LOGW(TAG, "no sensor samples available");
        return ESP_ERR_INVALID_STATE;
    }

    out->force1_avg = (int32_t)(force1_sum / count);
    out->force2_avg = (int32_t)(force2_sum / count);
    out->hall_avg = (int32_t)(hall_sum / count);
    out->current_delta_avg = (int32_t)(delta_sum / count);
    out->hall_min = hall_min;
    out->hall_max = hall_max;
    out->sample_count = count;

    return ESP_OK;
}

const char *calibration_manager_result_to_string(calibration_result_t result)
{
    switch (result) {
    case CAL_RESULT_NONE:
        return "NONE";

    case CAL_RESULT_RUNNING:
        return "RUNNING";

    case CAL_RESULT_PASS:
        return "PASS";

    case CAL_RESULT_WARNING:
        return "WARNING";

    case CAL_RESULT_FAIL:
        return "FAIL";

    case CAL_RESULT_CANCELLED:
        return "CANCELLED";

    case CAL_RESULT_EXPIRED:
        return "EXPIRED";

    default:
        return "UNKNOWN";
    }
}

esp_err_t calibration_manager_init(const device_config_t *cfg)
{
    if (cfg == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (s_cal_mutex == NULL) {
        s_cal_mutex = xSemaphoreCreateMutex();

        if (s_cal_mutex == NULL) {
            return ESP_ERR_NO_MEM;
        }
    }

    xSemaphoreTake(s_cal_mutex, portMAX_DELAY);

    memset(&s_report, 0, sizeof(s_report));
    s_cfg = *cfg;

    strncpy(
        s_report.profile_id,
        cfg->calibration_profile_id,
        sizeof(s_report.profile_id) - 1
    );

    s_report.result = CAL_RESULT_NONE;
    s_report.ready_for_session = false;

    xSemaphoreGive(s_cal_mutex);

    ESP_LOGI(TAG, "initialized with profile=%s", s_report.profile_id);

    return ESP_OK;
}

esp_err_t calibration_manager_apply_config(const device_config_t *cfg)
{
    if (cfg == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (s_cal_mutex == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    xSemaphoreTake(s_cal_mutex, portMAX_DELAY);

    s_cfg = *cfg;

    strncpy(
        s_report.profile_id,
        cfg->calibration_profile_id,
        sizeof(s_report.profile_id) - 1
    );

    /*
     * Any calibration/profile config update invalidates old readiness.
     */
    s_report.result = CAL_RESULT_NONE;
    s_report.ready_for_session = false;

    xSemaphoreGive(s_cal_mutex);

    ESP_LOGI(TAG, "config applied; readiness invalidated");

    return ESP_OK;
}

esp_err_t calibration_manager_start(const char *profile_id)
{
    if (s_cal_mutex == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    xSemaphoreTake(s_cal_mutex, portMAX_DELAY);

    memset(&s_report, 0, sizeof(s_report));

    if (profile_id != NULL && profile_id[0] != '\0') {
        strncpy(
            s_report.profile_id,
            profile_id,
            sizeof(s_report.profile_id) - 1
        );
    } else {
        strncpy(
            s_report.profile_id,
            s_cfg.calibration_profile_id,
            sizeof(s_report.profile_id) - 1
        );
    }

    s_report.result = CAL_RESULT_RUNNING;
    s_report.ready_for_session = false;
    s_report.started_at_ms = now_ms();

    xSemaphoreGive(s_cal_mutex);

    ESP_LOGI(TAG, "calibration started, profile=%s", s_report.profile_id);

    return ESP_OK;
}

esp_err_t calibration_manager_capture_normal(void)
{
    if (s_cal_mutex == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    calibration_sample_window_t window;

    esp_err_t err = collect_sample_window(&window);

    if (err != ESP_OK) {
        ESP_LOGW(TAG, "normal capture failed");
        return err;
    }

    xSemaphoreTake(s_cal_mutex, portMAX_DELAY);

    s_report.normal.hall_baseline_actual = window.hall_avg;
    s_report.normal.hall_noise = abs_i32(window.hall_max - window.hall_min);

    s_report.normal.force1_base_actual = window.force1_avg;
    s_report.normal.force2_base_actual = window.force2_avg;

    bool force1_ok =
        abs_pct_diff_i32(
            s_cfg.force1_base_reference,
            window.force1_avg
        ) <= (float)s_cfg.force_base_tolerance_pct;

    bool force2_ok =
        abs_pct_diff_i32(
            s_cfg.force2_base_reference,
            window.force2_avg
        ) <= (float)s_cfg.force_base_tolerance_pct;

    bool hall_stable =
        s_report.normal.hall_noise <= s_cfg.normal_hall_tolerance;

    s_report.normal.pass = force1_ok && force2_ok && hall_stable;

    xSemaphoreGive(s_cal_mutex);

    ESP_LOGI(
        TAG,
        "normal captured: hall=%ld noise=%ld f1=%ld f2=%ld samples=%lu pass=%s",
        (long)window.hall_avg,
        (long)s_report.normal.hall_noise,
        (long)window.force1_avg,
        (long)window.force2_avg,
        (unsigned long)window.sample_count,
        s_report.normal.pass ? "true" : "false"
    );

    return ESP_OK;
}

esp_err_t calibration_manager_capture_full_depth(void)
{
    if (s_cal_mutex == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    calibration_sample_window_t window;

    esp_err_t err = collect_sample_window(&window);

    if (err != ESP_OK) {
        ESP_LOGW(TAG, "full-depth capture failed");
        return err;
    }

    /*
     * Your current snapshot has current_delta.
     * During a full-depth test compression, use the absolute delta as the
     * observed peak-ish compression value for this MVP slice.
     *
     * Later, when sensor_runtime has calibration mode, this should become
     * real peak tracking across the whole press/release motion.
     */
    int32_t peak_delta = abs_i32(window.current_delta_avg);

    float mm_per_delta = 0.0f;

    if (s_cfg.full_depth_hall_delta > 0) {
        mm_per_delta =
            (float)s_cfg.full_depth_target_mm /
            (float)s_cfg.full_depth_hall_delta;
    }

    float estimated_depth_mm = (float)peak_delta * mm_per_delta;

    float depth_diff_pct = 100.0f;

    if (s_cfg.full_depth_target_mm > 0) {
        depth_diff_pct =
            (
                fabsf(
                    estimated_depth_mm -
                    (float)s_cfg.full_depth_target_mm
                ) /
                (float)s_cfg.full_depth_target_mm
            ) * 100.0f;
    }

    float imbalance =
        pressure_imbalance_pct(window.force1_avg, window.force2_avg);

    xSemaphoreTake(s_cal_mutex, portMAX_DELAY);

    s_report.depth.target_depth_mm = s_cfg.full_depth_target_mm;
    s_report.depth.peak_hall_delta = peak_delta;
    s_report.depth.estimated_depth_mm = estimated_depth_mm;
    s_report.depth.pass =
        depth_diff_pct <= (float)s_cfg.full_depth_tolerance_pct;

    s_report.pressure.force1_expected = s_cfg.force1_base_reference;
    s_report.pressure.force2_expected = s_cfg.force2_base_reference;
    s_report.pressure.force1_actual = window.force1_avg;
    s_report.pressure.force2_actual = window.force2_avg;
    s_report.pressure.imbalance_pct = imbalance;
    s_report.pressure.pass =
        imbalance <= (float)s_cfg.max_pressure_imbalance_pct;

    /*
     * MVP recoil check:
     * current_delta_avg should return near baseline after release.
     *
     * This becomes stronger later when sensor_runtime supports calibration
     * mode and can separately capture press peak and release return.
     */
    s_report.recoil.return_delta = window.current_delta_avg;
    s_report.recoil.pass =
        abs_i32(window.current_delta_avg) <=
        s_cfg.recoil_return_threshold_delta;

    xSemaphoreGive(s_cal_mutex);

    ESP_LOGI(
        TAG,
        "full-depth captured: delta=%ld estimatedDepth=%.1fmm imbalance=%.1f%% recoilDelta=%ld",
        (long)peak_delta,
        estimated_depth_mm,
        imbalance,
        (long)window.current_delta_avg
    );

    return ESP_OK;
}

esp_err_t calibration_manager_validate(void)
{
    if (s_cal_mutex == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    xSemaphoreTake(s_cal_mutex, portMAX_DELAY);

    bool pass =
        s_report.normal.pass &&
        s_report.pressure.pass &&
        s_report.depth.pass &&
        s_report.recoil.pass;

    s_report.validated_at_ms = now_ms();
    s_report.ready_for_session = pass;
    s_report.result = pass ? CAL_RESULT_PASS : CAL_RESULT_FAIL;

    xSemaphoreGive(s_cal_mutex);

    ESP_LOGI(TAG, "validation result=%s", pass ? "PASS" : "FAIL");

    return ESP_OK;
}

esp_err_t calibration_manager_cancel(void)
{
    if (s_cal_mutex == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    xSemaphoreTake(s_cal_mutex, portMAX_DELAY);

    s_report.result = CAL_RESULT_CANCELLED;
    s_report.ready_for_session = false;

    xSemaphoreGive(s_cal_mutex);

    ESP_LOGI(TAG, "calibration cancelled");

    return ESP_OK;
}

bool calibration_manager_is_ready(void)
{
    if (s_cal_mutex == NULL) {
        return false;
    }

    bool ready;

    xSemaphoreTake(s_cal_mutex, portMAX_DELAY);

    ready =
        s_report.ready_for_session &&
        s_report.result == CAL_RESULT_PASS;

    xSemaphoreGive(s_cal_mutex);

    return ready;
}

calibration_result_t calibration_manager_get_result(void)
{
    if (s_cal_mutex == NULL) {
        return CAL_RESULT_NONE;
    }

    calibration_result_t result;

    xSemaphoreTake(s_cal_mutex, portMAX_DELAY);
    result = s_report.result;
    xSemaphoreGive(s_cal_mutex);

    return result;
}

const calibration_report_t *calibration_manager_get_report(void)
{
    return &s_report;
}