#include "sensor_runtime.h"

#include <string.h>

#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include "hall_sensor.h"
#include "hx710.h"

/* =========================================================
 * Hardware pin mapping
 * Move these later into a board config header if needed.
 * ========================================================= */
#define HX710_1_SCK   GPIO_NUM_6
#define HX710_1_DOUT  GPIO_NUM_7
#define HX710_2_SCK   GPIO_NUM_4
#define HX710_2_DOUT  GPIO_NUM_5

#define HALL_ADC_CHAN ADC_CHANNEL_2

/* =========================================================
 * Task configuration
 * ========================================================= */
#define SENSOR_TASK_STACK_SIZE   4096
#define SENSOR_TASK_PRIORITY        5

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

/* =========================================================
 * Background task
 * Reads sensors only while a session has requested runtime.
 * ========================================================= */
static void sensor_task(void *arg)
{
    (void)arg;

    s_task_running = true;

    ESP_LOGI(TAG, "Sensor task entered running state");

    while (s_run_requested) {
        sensor_snapshot_t snap = {0};

        /* -----------------------------
         * Read force sensors (HX710)
         * ----------------------------- */
        snap.force1 = hx710_read(HX710_1_SCK, HX710_1_DOUT);
        snap.force2 = hx710_read(HX710_2_SCK, HX710_2_DOUT);

        /* Timeout is treated as read failure / disconnected */
        snap.force1_ok = (snap.force1 != HX710_ERROR_TIMEOUT);
        snap.force2_ok = (snap.force2 != HX710_ERROR_TIMEOUT);

        if (!snap.force1_ok) {
            ESP_LOGW(TAG, "Force sensor 1 timeout / disconnected");
        }

        if (!snap.force2_ok) {
            ESP_LOGW(TAG, "Force sensor 2 timeout / disconnected");
        }

        /* -----------------------------
         * Read hall sensor (depth proxy)
         * ----------------------------- */
        int hall_raw = 0;
        esp_err_t err = hall_sensor_read_raw(&s_hall_sensor, &hall_raw);

        if (err == ESP_OK) {
            snap.hall_ok = true;
            snap.hall_raw = hall_raw;

            /* Convert absolute ADC reading into depth-like delta */
            snap.current_delta = hall_sensor_calculate_delta(&s_hall_sensor, hall_raw);

            /* Update CPR logic using current depth */
            snap.feedback = cpr_logic_update(&s_cpr_state, &s_thresholds, snap.current_delta);
            snap.total_compressions = s_cpr_state.total_compressions;

            /* Log only when an evaluation event is produced */
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
            /* Keep the system alive even if hall read fails this cycle */
            snap.hall_ok = false;
            snap.feedback = CPR_FEEDBACK_NONE;
            snap.total_compressions = s_cpr_state.total_compressions;

            ESP_LOGW(TAG, "Hall sensor read failed: %s", esp_err_to_name(err));
        }

        /* -----------------------------
         * Publish latest snapshot safely
         * ----------------------------- */
        if (xSemaphoreTake(s_snapshot_mutex, pdMS_TO_TICKS(10)) == pdTRUE) {
            s_latest_snapshot = snap;
            xSemaphoreGive(s_snapshot_mutex);
        }

        /* Fixed-rate sampling loop */
        vTaskDelay(pdMS_TO_TICKS(s_sensor_task_period_ms));
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

esp_err_t sensor_runtime_start(void)
{
    if (!s_initialized) {
        return ESP_ERR_INVALID_STATE;
    }

    if (s_task_running || s_sensor_task_handle != NULL) {
        ESP_LOGI(TAG, "Sensor task already running");
        return ESP_OK;
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
        ESP_LOGE(TAG, "Failed to create sensor task");
        return ESP_FAIL;
    }

    ESP_LOGI(TAG, "Sensor task start requested");
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

    /* Reset CPR state so each session starts clean */
    cpr_logic_init(&s_cpr_state);

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