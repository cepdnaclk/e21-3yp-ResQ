#include "sensor_runtime.h"

#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include "board_config.h"
#include "cpr_logic.h"
#include "hall_sensor.h"
#include "hx710.h"

/* =========================================================
 * Hardware pin mapping
 * Move these later into a board config header if needed.
 * ========================================================= */
#define HX710_1_SCK   BOARD_HX710_1_SCK
#define HX710_1_DOUT  BOARD_HX710_1_DOUT
#define HX710_2_SCK   BOARD_HX710_2_SCK
#define HX710_2_DOUT  BOARD_HX710_2_DOUT

#define HALL_ADC_CHAN BOARD_HALL_ADC_CHAN

/* =========================================================
 * Task configuration
 * ========================================================= */
#define SENSOR_TASK_STACK_SIZE   4096
#define SENSOR_TASK_PRIORITY        5

/* robustness settings */
#define SENSOR_FAULT_DEBOUNCE_COUNT  3
#define SENSOR_GOOD_DEBOUNCE_COUNT   2
#define MIN_FEEDBACK_GAP_MS        120

static const char *TAG = "sensor_runtime";
static int s_sensor_task_period_ms = 20;

/* =========================================================
 * Internal module state
 * ========================================================= */
static hall_sensor_t s_hall_sensor;
static cpr_state_t s_cpr_state;
static cpr_thresholds_t s_thresholds;

static sensor_snapshot_t s_latest_snapshot;
static SemaphoreHandle_t s_snapshot_mutex = NULL;
static TaskHandle_t s_sensor_task_handle = NULL;

static bool s_initialized = false;
static volatile bool s_run_requested = false;
static volatile bool s_task_running = false;

/* filtered hall signal */
static int s_hall_filtered = 0;

/* stable sensor health state */
static bool s_force1_ok_stable = true;
static bool s_force2_ok_stable = true;
static bool s_hall_ok_stable = true;

/* debounce counters */
static int s_force1_fail_count = 0;
static int s_force1_good_count = 0;
static int s_force2_fail_count = 0;
static int s_force2_good_count = 0;
static int s_hall_fail_count = 0;
static int s_hall_good_count = 0;

/* suppress repeated feedback too quickly */
static TickType_t s_last_feedback_tick = 0;

static sensor_mode_t s_sensor_mode = SENSOR_MODE_IDLE;

sensor_mode_t sensor_runtime_get_mode(void)
{
    return s_sensor_mode;
}

bool sensor_runtime_is_calibrating(void)
{
    return s_sensor_mode == SENSOR_MODE_CALIBRATION && sensor_runtime_is_running();
}

bool sensor_runtime_is_session_active(void)
{
    return s_sensor_mode == SENSOR_MODE_SESSION && sensor_runtime_is_running();
}

static int iir_filter_step(int prev, int current)
{
    /* Simple 25% new + 75% old IIR filter */
    return (prev * 3 + current) / 4;
}

static bool update_stable_sensor_ok(bool raw_ok, bool *stable_ok, int *fail_count, int *good_count)
{
    if (raw_ok) {
        *fail_count = 0;
        (*good_count)++;

        if (*good_count >= SENSOR_GOOD_DEBOUNCE_COUNT) {
            *stable_ok = true;
        }
    } else {
        *good_count = 0;
        (*fail_count)++;

        if (*fail_count >= SENSOR_FAULT_DEBOUNCE_COUNT) {
            *stable_ok = false;
        }
    }

    return *stable_ok;
}

static bool feedback_gap_elapsed(void)
{
    TickType_t now = xTaskGetTickCount();

    if ((now - s_last_feedback_tick) < pdMS_TO_TICKS(MIN_FEEDBACK_GAP_MS)) {
        return false;
    }

    s_last_feedback_tick = now;
    return true;
}

/* =========================================================
 * Background task
 * Reads sensors only while a session has requested runtime.
 * ========================================================= */
static void sensor_task(void *arg)
{
    (void)arg;

    s_task_running = true;
    ESP_LOGI(TAG, "Sensor task entered running state");

    TickType_t last_wake = xTaskGetTickCount();

    while (s_run_requested) {
        sensor_snapshot_t snap = {0};

        snap.ts_ms = (uint64_t)(esp_timer_get_time() / 1000ULL);
        snap.mode = s_sensor_mode;
        snap.hall_filtered = s_hall_filtered;

        /* -----------------------------
         * Read force sensors
         * ----------------------------- */
        snap.force1 = hx710_read(BOARD_HX710_1_SCK, BOARD_HX710_1_DOUT);
        snap.force2 = hx710_read(BOARD_HX710_2_SCK, BOARD_HX710_2_DOUT);

        bool raw_force1_ok = (snap.force1 != HX710_ERROR_TIMEOUT);
        bool raw_force2_ok = (snap.force2 != HX710_ERROR_TIMEOUT);

        snap.force1_ok = update_stable_sensor_ok(
            raw_force1_ok,
            &s_force1_ok_stable,
            &s_force1_fail_count,
            &s_force1_good_count
        );

        snap.force2_ok = update_stable_sensor_ok(
            raw_force2_ok,
            &s_force2_ok_stable,
            &s_force2_fail_count,
            &s_force2_good_count
        );

        /* -----------------------------
         * Read hall sensor
         * ----------------------------- */
        int hall_raw = 0;
        esp_err_t err = hall_sensor_read_raw(&s_hall_sensor, &hall_raw);

        bool raw_hall_ok = (err == ESP_OK);

        snap.hall_ok = update_stable_sensor_ok(
            raw_hall_ok,
            &s_hall_ok_stable,
            &s_hall_fail_count,
            &s_hall_good_count
        );

        snap.hall_raw = hall_raw;

        if (raw_hall_ok) {
            s_hall_filtered = iir_filter_step(s_hall_filtered, hall_raw);
            snap.hall_filtered = s_hall_filtered;

            snap.current_delta = hall_sensor_calculate_delta(&s_hall_sensor, s_hall_filtered);

            cpr_feedback_t new_feedback = cpr_logic_update(
                &s_cpr_state,
                &s_thresholds,
                snap.current_delta
            );

            /* suppress unrealistically fast repeated events */
            if (new_feedback != CPR_FEEDBACK_NONE && !feedback_gap_elapsed()) {
                new_feedback = CPR_FEEDBACK_NONE;
            }

            snap.feedback = new_feedback;
            snap.total_compressions = s_cpr_state.total_compressions;

            if (snap.feedback != CPR_FEEDBACK_NONE) {
                ESP_LOGI(
                    TAG,
                    "Compression %d evaluated -> %s (delta=%d)",
                    snap.total_compressions,
                    cpr_feedback_to_string(snap.feedback),
                    snap.current_delta
                );
            }
        } else {
            /* keep previous filtered value, but do not update CPR logic this cycle */
            snap.hall_filtered = s_hall_filtered;
            snap.feedback = CPR_FEEDBACK_NONE;
            snap.total_compressions = s_cpr_state.total_compressions;
        }

        if (xSemaphoreTake(s_snapshot_mutex, pdMS_TO_TICKS(10)) == pdTRUE) {
            s_latest_snapshot = snap;
            xSemaphoreGive(s_snapshot_mutex);
        }

        vTaskDelayUntil(&last_wake, pdMS_TO_TICKS(s_sensor_task_period_ms));
    }

    ESP_LOGI(TAG, "Sensor task stopping");

    s_sensor_task_handle = NULL;
    s_task_running = false;

    vTaskDelete(NULL);
}

/* =========================================================
 * Public API
 * ========================================================= */
esp_err_t sensor_runtime_init(const device_config_t *cfg)
{
    if (cfg == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (s_initialized) {
        return ESP_OK;
    }

    hx710_init(HX710_1_SCK, HX710_1_DOUT);
    hx710_init(HX710_2_SCK, HX710_2_DOUT);

    esp_err_t err = hall_sensor_init(&s_hall_sensor, HALL_ADC_CHAN, cfg->hall_baseline);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "hall_sensor_init failed: %s", esp_err_to_name(err));
        return err;
    }

    cpr_logic_init(&s_cpr_state);

    s_thresholds.hall_min_delta = cfg->hall_min_delta;
    s_thresholds.hall_max_delta = cfg->hall_max_delta;
    s_hall_filtered = cfg->hall_baseline;
    s_thresholds.compression_start_delta = cfg->compression_start_delta;

    s_sensor_task_period_ms = cfg->sensor_sample_interval_ms;

    s_snapshot_mutex = xSemaphoreCreateMutex();
    if (s_snapshot_mutex == NULL) {
        ESP_LOGE(TAG, "Failed to create snapshot mutex");
        return ESP_ERR_NO_MEM;
    }

    memset(&s_latest_snapshot, 0, sizeof(s_latest_snapshot));

    s_run_requested = false;
    s_task_running = false;
    s_sensor_task_handle = NULL;
    s_initialized = true;

    ESP_LOGI(TAG, "Sensor runtime initialized from config");
    return ESP_OK;
}

esp_err_t sensor_runtime_apply_config(const device_config_t *cfg)
{
    if (!s_initialized || cfg == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    if (s_task_running) {
        ESP_LOGW(TAG, "Cannot apply sensor config while sensor task is running");
        return ESP_ERR_INVALID_STATE;
    }

    s_hall_sensor.baseline = cfg->hall_baseline;

    s_thresholds.hall_min_delta = cfg->hall_min_delta;
    s_thresholds.hall_max_delta = cfg->hall_max_delta;
    s_thresholds.compression_start_delta = cfg->compression_start_delta;

    s_sensor_task_period_ms = cfg->sensor_sample_interval_ms;

    ESP_LOGI(TAG, "Sensor config updated");
    return ESP_OK;
}

esp_err_t sensor_runtime_start(sensor_mode_t mode)
{
    if (!s_initialized) {
        return ESP_ERR_INVALID_STATE;
    }

    if (mode != SENSOR_MODE_CALIBRATION && mode != SENSOR_MODE_SESSION) {
        ESP_LOGE(TAG, "Invalid sensor runtime mode: %d", mode);
        return ESP_ERR_INVALID_ARG;
    }

    if (s_task_running || s_sensor_task_handle != NULL) {
        if (s_sensor_mode == mode) {
            ESP_LOGI(TAG, "Sensor task already running in requested mode");
            return ESP_OK;
        }

        ESP_LOGW(TAG, "Sensor task already running in another mode");
        return ESP_ERR_INVALID_STATE;
    }

    s_sensor_mode = mode;

    /*
     * Reset CPR session counters only for actual session mode.
     * Calibration mode should not reset or count CPR session data.
     */
    if (mode == SENSOR_MODE_SESSION) {
        sensor_runtime_reset_session_data();
    }

    s_run_requested = true;

    BaseType_t result = xTaskCreate(
        sensor_task,
        "sensor_task",
        SENSOR_TASK_STACK_SIZE,
        NULL,
        SENSOR_TASK_PRIORITY,
        &s_sensor_task_handle
    );

    if (result != pdPASS) {
        s_run_requested = false;
        s_sensor_task_handle = NULL;
        s_sensor_mode = SENSOR_MODE_IDLE;

        ESP_LOGE(TAG, "Failed to create sensor task");
        return ESP_FAIL;
    }

    ESP_LOGI(
        TAG,
        "Sensor task start requested, mode=%s",
        mode == SENSOR_MODE_CALIBRATION ? "CALIBRATION" : "SESSION"
    );

    return ESP_OK;
}

esp_err_t sensor_runtime_stop(void)
{
    if (!s_initialized) {
        return ESP_ERR_INVALID_STATE;
    }

    if (!s_task_running && s_sensor_task_handle == NULL) {
        ESP_LOGI(TAG, "Sensor task already stopped");
        return ESP_OK;
    }

    s_run_requested = false;

    /* Wait briefly for task loop to exit cleanly */
    for (int i = 0; i < 40; i++) {
        if (!s_task_running && s_sensor_task_handle == NULL) {
            ESP_LOGI(TAG, "Sensor task stopped cleanly");
            return ESP_OK;
        }
        vTaskDelay(pdMS_TO_TICKS(25));
    }

    s_sensor_mode = SENSOR_MODE_IDLE;

    ESP_LOGW(TAG, "Timed out waiting for sensor task to stop");
    return ESP_ERR_TIMEOUT;
}

bool sensor_runtime_is_running(void)
{
    return s_task_running;
}

esp_err_t sensor_runtime_reset_session_data(void)
{
    if (!s_initialized) {
        return ESP_ERR_INVALID_STATE;
    }

    cpr_logic_init(&s_cpr_state);

    s_hall_filtered = s_hall_sensor.baseline;
    s_last_feedback_tick = 0;

    s_force1_ok_stable = true;
    s_force2_ok_stable = true;
    s_hall_ok_stable = true;

    s_force1_fail_count = 0;
    s_force1_good_count = 0;
    s_force2_fail_count = 0;
    s_force2_good_count = 0;
    s_hall_fail_count = 0;
    s_hall_good_count = 0;

    if (xSemaphoreTake(s_snapshot_mutex, pdMS_TO_TICKS(10)) == pdTRUE) {
        memset(&s_latest_snapshot, 0, sizeof(s_latest_snapshot));
        xSemaphoreGive(s_snapshot_mutex);
    }

    ESP_LOGI(TAG, "Sensor session data reset");
    return ESP_OK;
}

esp_err_t sensor_runtime_get_latest(sensor_snapshot_t *out)
{
    if (out == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (!s_initialized || s_snapshot_mutex == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    if (xSemaphoreTake(s_snapshot_mutex, pdMS_TO_TICKS(10)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }

    *out = s_latest_snapshot;
    xSemaphoreGive(s_snapshot_mutex);

    return ESP_OK;
}
