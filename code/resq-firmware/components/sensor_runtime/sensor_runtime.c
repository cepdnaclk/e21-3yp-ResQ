#include "sensor_runtime.h"

#include <string.h>

#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include "hall_sensor.h"
#include "hx710.h"

/* =========================================================
 * Local hardware pin assignments
 * These are currently hardcoded for this board revision.
 * ========================================================= */
#define HX710_1_SCK  GPIO_NUM_6
#define HX710_1_DOUT GPIO_NUM_7
#define HX710_2_SCK  GPIO_NUM_4
#define HX710_2_DOUT GPIO_NUM_5

/* ADC channel used by the hall sensor */
#define HALL_ADC_CHAN ADC_CHANNEL_2

/* =========================================================
 * CPR calibration values
 * These thresholds define depth quality categories.
 * ========================================================= */
#define HALL_BASELINE           3420
#define HALL_MIN_DELTA           520
#define HALL_MAX_DELTA          1060
#define COMPRESSION_START_DELTA  200

/* Background sampling task configuration */
#define SENSOR_TASK_PERIOD_MS     20
#define SENSOR_TASK_STACK_SIZE  4096
#define SENSOR_TASK_PRIORITY       5

static const char *TAG = "sensor_runtime";

/* ---------- Module-private runtime state ---------- */

/* Hall sensor driver handle/config */
static hall_sensor_t s_hall_sensor;

/* CPR state machine data (compression count, current phase, etc.) */
static cpr_state_t s_cpr_state;

/* CPR depth thresholds used by cpr_logic_update() */
static cpr_thresholds_t s_thresholds;

/* Last fully processed sensor sample */
static sensor_snapshot_t s_latest_snapshot;

/* Mutex protecting s_latest_snapshot for cross-task access */
static SemaphoreHandle_t s_snapshot_mutex = NULL;

/* Handle of the sampling task once created */
static TaskHandle_t s_sensor_task_handle = NULL;

/* True after successful init; prevents double initialization */
static bool s_initialized = false;

/**
 * @brief Background task that continuously samples sensors.
 *
 * Flow:
 *  1) Read both HX710 force sensors
 *  2) Read hall sensor and update CPR logic
 *  3) Publish one coherent snapshot under mutex
 *  4) Sleep for SENSOR_TASK_PERIOD_MS
 */
static void sensor_task(void *arg)
{
    (void)arg;

    while (1) {
        /* Local snapshot assembled first, then copied atomically */
        sensor_snapshot_t snap = {0};

        /* -----------------------------
         * Read force sensors (HX710)
         * ----------------------------- */
        snap.force1 = hx710_read(HX710_1_SCK, HX710_1_DOUT);
        snap.force2 = hx710_read(HX710_2_SCK, HX710_2_DOUT);

        /* Timeout is used as "read failed/disconnected" marker */
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

            /* Update CPR finite-state logic using current depth */
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
            /* Keep system running even if hall read fails this cycle */
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
        vTaskDelay(pdMS_TO_TICKS(SENSOR_TASK_PERIOD_MS));
    }
}

/**
 * @brief Initialize sensor runtime module and dependencies.
 *
 * Initializes:
 *  - HX710 GPIO interfaces
 *  - Hall sensor driver
 *  - CPR state and thresholds
 *  - Snapshot mutex
 */
esp_err_t sensor_runtime_init(void)
{
    if (s_initialized) {
        return ESP_OK;
    }

    /* Initialize HX710 sensor GPIO interfaces */
    hx710_init(HX710_1_SCK, HX710_1_DOUT);
    hx710_init(HX710_2_SCK, HX710_2_DOUT);

    /* Initialize hall sensor with configured baseline */
    esp_err_t err = hall_sensor_init(&s_hall_sensor, HALL_ADC_CHAN, HALL_BASELINE);
    if (err != ESP_OK) {
        return err;
    }

    /* Reset CPR logic state machine */
    cpr_logic_init(&s_cpr_state);

    /* Set compression quality thresholds */
    s_thresholds.hall_min_delta = HALL_MIN_DELTA;
    s_thresholds.hall_max_delta = HALL_MAX_DELTA;
    s_thresholds.compression_start_delta = COMPRESSION_START_DELTA;

    /* Create mutex for snapshot sharing between tasks */
    s_snapshot_mutex = xSemaphoreCreateMutex();
    if (s_snapshot_mutex == NULL) {
        return ESP_ERR_NO_MEM;
    }

    /* Start with a known zeroed snapshot */
    memset(&s_latest_snapshot, 0, sizeof(s_latest_snapshot));

    s_initialized = true;
    ESP_LOGI(TAG, "Sensor runtime initialized");
    return ESP_OK;
}

/**
 * @brief Start background sensor sampling task.
 *
 * Safe to call multiple times; second call is a no-op.
 */
esp_err_t sensor_runtime_start(void)
{
    if (!s_initialized) {
        return ESP_ERR_INVALID_STATE;
    }

    if (s_sensor_task_handle != NULL) {
        return ESP_OK;
    }

    BaseType_t result = xTaskCreate(
        sensor_task,
        "sensor_task",
        SENSOR_TASK_STACK_SIZE,
        NULL,
        SENSOR_TASK_PRIORITY,
        &s_sensor_task_handle
    );

    if (result != pdPASS) {
        s_sensor_task_handle = NULL;
        return ESP_FAIL;
    }

    ESP_LOGI(TAG, "Sensor task started");
    return ESP_OK;
}

/**
 * @brief Copy the latest snapshot into caller-provided buffer.
 *
 * @param[out] out Destination pointer to receive snapshot.
 * @return ESP_OK on success, or an error if invalid state/timeout.
 */
esp_err_t sensor_runtime_get_latest(sensor_snapshot_t *out)
{
    if (out == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (!s_initialized || s_snapshot_mutex == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    /* Lock briefly to copy a consistent snapshot */
    if (xSemaphoreTake(s_snapshot_mutex, pdMS_TO_TICKS(10)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }

    *out = s_latest_snapshot;
    xSemaphoreGive(s_snapshot_mutex);

    return ESP_OK;
}