#include "calibration_manager.h"

#include <stdlib.h>
#include <string.h>

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
#include "calibration_codes.h"
#include "cJSON.h"

/* Calibration manager configuration */
#define CALIBRATION_TASK_STACK_SIZE             4096
#define CALIBRATION_TASK_PRIORITY               5

#define CALIBRATION_POLL_DELAY_MS               50
#define CALIBRATION_MAX_WAIT_MS                 30000

/* Private variables */
static const char *TAG = "calibration_manager";

static TaskHandle_t s_calibration_task_handle = NULL;

static calibration_config_t s_calibration_config;

static hall_sensor_t s_hall_sensor;

static network_config_t s_network_config;

/* current command id for the running calibration */
static char s_command_id[64] = {0};

static bool s_initialized = false;
static bool s_running = false;
static calibration_reason_id_t s_last_failure_reason = CAL_REASON_NONE;
static calibration_action_id_t s_last_failure_action = CAL_ACTION_NONE;
static calibration_config_t s_last_host_params;
static bool s_has_last_host_params = false;

/* =========================================================
 * Small internal helper functions
 * ========================================================= */

static void publish_calibration_progress(calibration_reason_id_t reason_id,
                                         resq_state_t state,
                                         calibration_action_id_t action_id)
{
    char payload[256];

    int written = snprintf(payload,
                           sizeof(payload),
                           "{"
                           "\"event_type\":\"calibration_progress\","
                           "\"reason_id\":%d,"
                           "\"state\":\"%s\","
                           "\"action_id\":%d,"
                           "\"ts_ms\":%lld"
                           "}",
                           (int)reason_id,
                           resq_state_to_string(state),
                           (int)action_id,
                           (long long)(esp_timer_get_time() / 1000));

    if (written <= 0 || written >= (int)sizeof(payload)) {
        ESP_LOGE(TAG, "Calibration progress payload too large");
        return;
    }

    if (mqtt_manager_is_connected()) {
        mqtt_manager_publish_topic_json("events/calibration/progress", payload);
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
 * @brief Read HX710 safely and convert timeout into ESP error.
 */
static esp_err_t calibration_read_pressure_once(gpio_num_t sck_pin,
                                                gpio_num_t dout_pin,
                                                int32_t *out_value)
{
    if (out_value == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    int32_t value = hx710_read(sck_pin, dout_pin);

    if (value == HX710_ERROR_TIMEOUT) {
        return ESP_ERR_TIMEOUT;
    }

    *out_value = value;
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

    for (int i = 0; i < CALIBRATION_AVERAGE_SAMPLE_COUNT; i++) {
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

    *out_value = (int32_t)(sum / CALIBRATION_AVERAGE_SAMPLE_COUNT);

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

    for (int i = 0; i < CALIBRATION_AVERAGE_SAMPLE_COUNT; i++) {
        int raw_value = 0;

        esp_err_t err = hall_sensor_read_raw(&s_hall_sensor, &raw_value);
        if (err != ESP_OK) {
            return err;
        }

        sum += raw_value;
        vTaskDelay(pdMS_TO_TICKS(5));
    }

    *out_value = (int32_t)(sum / CALIBRATION_AVERAGE_SAMPLE_COUNT);

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

            vTaskDelay(pdMS_TO_TICKS(CALIBRATION_POLL_DELAY_MS));
            elapsed_ms += CALIBRATION_POLL_DELAY_MS;
            continue;
        }

        ESP_LOGI(TAG,
                 "%s current=%ld target=%ld",
                 label,
                 (long)current_value,
                 (long)target_value);

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
     * Step 1: Match pressure sensor 0 with ref_pressure
     * ----------------------------------------------------- */
    publish_calibration_progress(CAL_REASON_NONE,
                                 RESQ_STATE_CALIBRATING,
                                 CAL_ACTION_NONE);
    esp_err_t err = calibration_wait_for_pressure_target(
        "pressure_sensor_0",
        BOARD_HX710_0_SCK,
        BOARD_HX710_0_DOUT,
        s_calibration_config.ref_pressure,
        CALIBRATION_PRESSURE_TOLERANCE_RAW,
        &matched_ref_pressure);

    if (err != ESP_OK) {
        calibration_manager_fail(CAL_REASON_REF_PRESSURE_TIMEOUT);
        goto task_exit;
    }

    publish_calibration_progress(CAL_REASON_NONE,
                                 RESQ_STATE_CALIBRATING,
                                 CAL_ACTION_NONE);

    /*
     * ref_pressure is target from LocalHub.
     * matched_ref_pressure is observed value.
     * For this first version we keep the target value in config.
     */

    /* -----------------------------------------------------
     * Step 2: Match pressure sensor 1 with bladder_1_pressure
     * ----------------------------------------------------- */

    publish_calibration_progress(CAL_REASON_NONE,
                                 RESQ_STATE_CALIBRATING,
                                 CAL_ACTION_NONE);

    err = calibration_wait_for_pressure_target(
        "pressure_sensor_1",
        BOARD_HX710_1_SCK,
        BOARD_HX710_1_DOUT,
        s_calibration_config.bladder_1_pressure,
        CALIBRATION_PRESSURE_TOLERANCE_RAW,
        &matched_bladder_1_pressure);

    if (err != ESP_OK) {
        calibration_manager_fail(CAL_REASON_BLADDER_1_PRESSURE_TIMEOUT);
        goto task_exit;
    }

    publish_calibration_progress(CAL_REASON_NONE,
                                 RESQ_STATE_CALIBRATING,
                                 CAL_ACTION_NONE);

    /* -----------------------------------------------------
     * Step 3: Match pressure sensor 2 with bladder_2_pressure
     * ----------------------------------------------------- */

    publish_calibration_progress(CAL_REASON_NONE,
                                 RESQ_STATE_CALIBRATING,
                                 CAL_ACTION_NONE);

    err = calibration_wait_for_pressure_target(
        "pressure_sensor_2",
        BOARD_HX710_2_SCK,
        BOARD_HX710_2_DOUT,
        s_calibration_config.bladder_2_pressure,
        CALIBRATION_PRESSURE_TOLERANCE_RAW,
        &matched_bladder_2_pressure);

    if (err != ESP_OK) {
        calibration_manager_fail(CAL_REASON_BLADDER_2_PRESSURE_TIMEOUT);
        goto task_exit;
    }

    publish_calibration_progress(CAL_REASON_NONE,
                                 RESQ_STATE_CALIBRATING,
                                 CAL_ACTION_NONE);

    /*
     * Store the matched baseline bladder pressure values.
     * These are close to the host-provided targets but represent
     * the actual accepted sensor readings.
     */
    s_calibration_config.bladder_1_pressure = matched_bladder_1_pressure;
    s_calibration_config.bladder_2_pressure = matched_bladder_2_pressure;

    /* -----------------------------------------------------
     * Step 4: Capture Hall baseline at rest position
     * ----------------------------------------------------- */

    int32_t hall_baseline = 0;

    err = calibration_read_hall_average(&hall_baseline);
    if (err != ESP_OK) {
        calibration_manager_fail(CAL_REASON_HALL_BASELINE_READ_FAILED);
        goto task_exit;
    }

    s_calibration_config.hall_baseline = hall_baseline;

    ESP_LOGI(TAG,
             "Hall baseline captured: %ld",
             (long)s_calibration_config.hall_baseline);

    publish_calibration_progress(CAL_REASON_NONE,
                                 RESQ_STATE_CALIBRATING,
                                 CAL_ACTION_NONE);

    /* -----------------------------------------------------
     * Step 5: Calculate expected full-press Hall value
     *
     * According to your diagram:
     * hall_baseline - hall_delta == read_hall_value()
     * ----------------------------------------------------- */

    s_calibration_config.hall_full_press =
        s_calibration_config.hall_baseline -
        s_calibration_config.hall_delta;

    ESP_LOGI(TAG,
             "Hall full press target calculated: baseline=%ld delta=%ld full_press=%ld",
             (long)s_calibration_config.hall_baseline,
             (long)s_calibration_config.hall_delta,
             (long)s_calibration_config.hall_full_press);

    publish_calibration_progress(CAL_REASON_NONE,
                                 RESQ_STATE_CALIBRATING,
                                 CAL_ACTION_NONE);

    /* -----------------------------------------------------
     * Step 6: Wait for instructor compression until Hall matches
     * ----------------------------------------------------- */

    int32_t matched_hall_full_press = 0;

    err = calibration_wait_for_hall_target(
        s_calibration_config.hall_full_press,
        CALIBRATION_HALL_TOLERANCE_RAW,
        &matched_hall_full_press);

    if (err != ESP_OK) {
        calibration_manager_fail(CAL_REASON_HALL_FULL_PRESS_TIMEOUT);
        goto task_exit;
    }

    /*
     * Store the actual matched full-press Hall value.
     * This is more realistic than storing only the calculated target.
     */
    s_calibration_config.hall_full_press = matched_hall_full_press;

    publish_calibration_progress(CAL_REASON_NONE,
                                 RESQ_STATE_CALIBRATING,
                                 CAL_ACTION_NONE);

    /* -----------------------------------------------------
     * Step 7: Capture full-compression pressure sensor values
     * ----------------------------------------------------- */

    err = calibration_read_pressure_average(
        BOARD_HX710_1_SCK,
        BOARD_HX710_1_DOUT,
        &s_calibration_config.bladder_1_full_press);

    if (err != ESP_OK) {
        calibration_manager_fail(CAL_REASON_FULL_PRESS_PRESSURE_READ_FAILED);
        goto task_exit;
    }

    err = calibration_read_pressure_average(
        BOARD_HX710_2_SCK,
        BOARD_HX710_2_DOUT,
        &s_calibration_config.bladder_2_full_press);

    if (err != ESP_OK) {
        calibration_manager_fail(CAL_REASON_FULL_PRESS_PRESSURE_READ_FAILED);
        goto task_exit;
    }

    ESP_LOGI(TAG,
             "Full press captured: bladder1=%ld bladder2=%ld",
             (long)s_calibration_config.bladder_1_full_press,
             (long)s_calibration_config.bladder_2_full_press);

    /* -----------------------------------------------------
     * Step 8: Validate and save
     * ----------------------------------------------------- */

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

    /* Initialize pressure sensor 0 */
    esp_err_t err = hx710_init(BOARD_HX710_0_SCK,
                               BOARD_HX710_0_DOUT);
    if (err != ESP_OK) {
        ESP_LOGE(TAG,
                 "Failed to init pressure sensor 0: %s",
                 esp_err_to_name(err));
        return err;
    }

    /* Initialize pressure sensor 1 */
    err = hx710_init(BOARD_HX710_1_SCK,
                     BOARD_HX710_1_DOUT);
    if (err != ESP_OK) {
        ESP_LOGE(TAG,
                 "Failed to init pressure sensor 1: %s",
                 esp_err_to_name(err));
        return err;
    }

    /* Initialize pressure sensor 2 */
    err = hx710_init(BOARD_HX710_2_SCK,
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
        host_params->hall_delta <= 0) {

        ESP_LOGE(TAG, "Invalid host calibration parameters");
        return ESP_ERR_INVALID_ARG;
    }

    /*
     * Clear previous calibration values.
     * Then copy only the host-provided target parameters.
     */
    calibration_config_set_defaults(&s_calibration_config);

    s_calibration_config.ref_pressure = host_params->ref_pressure;
    s_calibration_config.bladder_1_pressure = host_params->bladder_1_pressure;
    s_calibration_config.bladder_2_pressure = host_params->bladder_2_pressure;
    s_calibration_config.hall_delta = host_params->hall_delta;
    s_calibration_config.calibrated = false;

    /* save host params so BUTTON_1 retry can reuse them */
    memcpy(&s_last_host_params, host_params, sizeof(s_last_host_params));
    s_has_last_host_params = true;
    s_last_failure_reason = CAL_REASON_NONE;
    s_last_failure_action = CAL_ACTION_NONE;

    /* copy network config and command id into static state for progress publishing */
    memcpy(&s_network_config, network_config, sizeof(network_config_t));
    strncpy(s_command_id, command_id, sizeof(s_command_id) - 1);
    s_command_id[sizeof(s_command_id) - 1] = '\0';

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

    cJSON *command_id = cJSON_GetObjectItemCaseSensitive(root, "command_id");
    cJSON *event_type = cJSON_GetObjectItemCaseSensitive(root, "event_type");
    cJSON *hall_delta = cJSON_GetObjectItemCaseSensitive(root, "hall_delta");
    cJSON *ref_pressure = cJSON_GetObjectItemCaseSensitive(root, "ref_pressure");
    cJSON *bladder_1_pressure = cJSON_GetObjectItemCaseSensitive(root, "bladder_1_pressure");
    cJSON *bladder_2_pressure = cJSON_GetObjectItemCaseSensitive(root, "bladder_2_pressure");

    if (!cJSON_IsString(command_id) || command_id->valuestring == NULL ||
        !cJSON_IsString(event_type) || event_type->valuestring == NULL ||
        strcmp(event_type->valuestring, "calibration_start") != 0 ||
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

    if (hall_delta->valuedouble <= 0) {
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

exit:
    cJSON_Delete(root);
    return result;
}