#include "paired_idle_manager.h"

#include <stdbool.h>
#include <stdio.h>
#include <string.h>

#include "cJSON.h"

#include "esp_err.h"
#include "esp_log.h"
#include "esp_timer.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "board_config.h"
#include "hall_sensor.h"
#include "hx710.h"
#include "mqtt_manager.h"
#include "status_indicator.h"
#include "wifi_manager.h"
#include "runtime_helpers.h"

static const char *TAG = "paired_idle";

static bool s_initialized = false;

static int64_t now_ms(void)
{
    return esp_timer_get_time() / 1000;
}


static esp_err_t paired_idle_handle_debug(const network_config_t *network_config)
{
    int32_t pressure_0_raw = hx710_read(BOARD_HX710_0_SCK,
                                        BOARD_HX710_0_DOUT);

    if (pressure_0_raw == HX710_ERROR_TIMEOUT) {
        return ESP_FAIL;
    }

    int32_t pressure_1_raw = hx710_read(BOARD_HX710_1_SCK,
                                        BOARD_HX710_1_DOUT);

    if (pressure_1_raw == HX710_ERROR_TIMEOUT) {
        return ESP_FAIL;
    }

    int32_t pressure_2_raw = hx710_read(BOARD_HX710_2_SCK,
                                        BOARD_HX710_2_DOUT);

    if (pressure_2_raw == HX710_ERROR_TIMEOUT) {
        return ESP_FAIL;
    }

    int hall_raw = 0;

    hall_sensor_t local_hall = {0};
    esp_err_t hall_err = hall_sensor_init(&local_hall, BOARD_HALL_ADC_CHAN);
    if (hall_err != ESP_OK) {
        return hall_err;
    }

    hall_err = hall_sensor_read_raw(&local_hall, &hall_raw);
    if (hall_err != ESP_OK) {
        return hall_err;
    }

    char payload[384];

    int written = snprintf(payload,
                           sizeof(payload),
                           "{"
                           "\"device_id\":\"%s\","
                           "\"pressure_0_raw\":%ld,"
                           "\"pressure_1_raw\":%ld,"
                           "\"pressure_2_raw\":%ld,"
                           "\"hall_raw\":%d,"
                           "\"ts_ms\":%lld"
                           "}",
                           runtime_helpers_get_device_id(network_config),
                           (long)pressure_0_raw,
                           (long)pressure_1_raw,
                           (long)pressure_2_raw,
                           hall_raw,
                           (long long)now_ms());

    if (written <= 0 || written >= (int)sizeof(payload)) {
        return ESP_ERR_INVALID_SIZE;
    }

    return mqtt_manager_publish_debug_json(payload);
}

static esp_err_t paired_idle_parse_calibration_start(const char *payload,
                                                    calibration_config_t *calibration_config)
{
    if (payload == NULL || calibration_config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    cJSON *root = cJSON_Parse(payload);
    if (root == NULL) {
        return ESP_FAIL;
    }

    esp_err_t result = ESP_OK;

    cJSON *hall_delta = cJSON_GetObjectItemCaseSensitive(root, "hall_delta");
    cJSON *ref_pressure = cJSON_GetObjectItemCaseSensitive(root, "ref_pressure");
    cJSON *bladder_1_pressure = cJSON_GetObjectItemCaseSensitive(root, "bladder_1_pressure");
    cJSON *bladder_2_pressure = cJSON_GetObjectItemCaseSensitive(root, "bladder_2_pressure");

    if (!cJSON_IsNumber(hall_delta) ||
        !cJSON_IsNumber(ref_pressure) ||
        !cJSON_IsNumber(bladder_1_pressure) ||
        !cJSON_IsNumber(bladder_2_pressure)) {
        result = ESP_FAIL;
        goto exit;
    }

    calibration_config->hall_delta = (int32_t)hall_delta->valuedouble;
    calibration_config->ref_pressure = (int32_t)ref_pressure->valuedouble;
    calibration_config->bladder_1_pressure = (int32_t)bladder_1_pressure->valuedouble;
    calibration_config->bladder_2_pressure = (int32_t)bladder_2_pressure->valuedouble;

    /*
     * Starting calibration invalidates previous result.
     * The CALIBRATING state will capture final values and set calibrated=true only on pass.
     */
    calibration_config->calibrated = false;

exit:
    cJSON_Delete(root);
    return result;
}

esp_err_t paired_idle_manager_init(void)
{
    if (s_initialized) {
        return ESP_OK;
    }

    s_initialized = true;

    ESP_LOGI(TAG, "Paired idle manager initialized");

    return ESP_OK;
}

resq_state_t paired_idle_manager_run(network_config_t *network_config,
                                     calibration_config_t *calibration_config,
                                     const char *ip_address)
{
    if (!s_initialized) {
        return RESQ_STATE_ERROR;
    }

    if (network_config == NULL || calibration_config == NULL) {
        return RESQ_STATE_ERROR;
    }

    status_indicator_set_state(RESQ_STATE_PAIRED_IDLE);

    /*
     * Publish retained status on entry.
     */
    mqtt_manager_publish_status(RESQ_STATE_PAIRED_IDLE,
                                network_config,
                                calibration_config,
                                false,
                                "",
                                ip_address);

    while (true) {
        /*
         * If calibration is already valid, this device is no longer just paired idle.
         * Move to READY_FOR_SESSION.
         */
        if (calibration_config->calibrated) {
            ESP_LOGI(TAG, "Calibration already valid. Moving to READY_FOR_SESSION.");
            return RESQ_STATE_READY_FOR_SESSION;
        }

        /*
         * Any connectivity failure in this simple state design goes to ERROR.
         */
        if (!wifi_manager_is_connected()) {
            runtime_helpers_publish_error_event(network_config,
                                                 RESQ_STATE_PAIRED_IDLE,
                                                 "WIFI_DISCONNECTED",
                                                 "Wi-Fi disconnected in PAIRED_IDLE");
            return RESQ_STATE_ERROR;
        }

        if (!mqtt_manager_is_connected()) {
            runtime_helpers_publish_error_event(network_config,
                                                 RESQ_STATE_PAIRED_IDLE,
                                                 "MQTT_DISCONNECTED",
                                                 "MQTT disconnected in PAIRED_IDLE");
            return RESQ_STATE_ERROR;
        }

        resq_mqtt_command_t command = {0};

        esp_err_t wait_err = mqtt_manager_wait_for_command(&command,
                                                           pdMS_TO_TICKS(500));

        if (wait_err == ESP_ERR_TIMEOUT) {
            continue;
        }

        if (wait_err != ESP_OK) {
            runtime_helpers_publish_error_event(network_config,
                                                 RESQ_STATE_PAIRED_IDLE,
                                                 "COMMAND_WAIT_FAILED",
                                                 "Failed while waiting for MQTT command");
            return RESQ_STATE_ERROR;
        }

        const char *command_suffix = runtime_helpers_get_command_suffix(command.topic);

        if (command_suffix == NULL) {
            runtime_helpers_publish_error_event(network_config,
                                                 RESQ_STATE_PAIRED_IDLE,
                                                 "INVALID_COMMAND_TOPIC",
                                                 "Command topic does not contain /cmd/");
            return RESQ_STATE_ERROR;
        }

        if (strcmp(command_suffix, "cmd/debug") == 0) {
            esp_err_t debug_err = paired_idle_handle_debug(network_config);

            if (debug_err != ESP_OK) {
                runtime_helpers_publish_error_event(network_config,
                                                     RESQ_STATE_PAIRED_IDLE,
                                                     "DEBUG_READ_FAILED",
                                                     "Failed to read or publish debug raw values");
                return RESQ_STATE_ERROR;
            }

            runtime_helpers_publish_command_result(network_config,
                                                   RESQ_STATE_PAIRED_IDLE,
                                                   "cmd/debug",
                                                   "ACK",
                                                   "debug_published");

            continue;
        }

        if (strcmp(command_suffix, "cmd/calibration/start") == 0) {
            esp_err_t parse_err = paired_idle_parse_calibration_start(command.payload,
                                                                     calibration_config);

            if (parse_err != ESP_OK) {
                runtime_helpers_publish_error_event(network_config,
                                                     RESQ_STATE_PAIRED_IDLE,
                                                     "INVALID_CALIBRATION_START_PAYLOAD",
                                                     "Missing or invalid calibration start values");
                return RESQ_STATE_ERROR;
            }

            runtime_helpers_publish_command_result(network_config,
                                                   RESQ_STATE_PAIRED_IDLE,
                                                   "cmd/calibration/start",
                                                   "ACK",
                                                   "moving_to_calibrating");

            return RESQ_STATE_CALIBRATING;
        }

        /*
         * In this current strict design, unknown commands in PAIRED_IDLE are errors.
         */
        runtime_helpers_publish_error_event(network_config,
                             RESQ_STATE_PAIRED_IDLE,
                             "UNKNOWN_COMMAND_IN_PAIRED_IDLE",
                             command_suffix);

        return RESQ_STATE_ERROR;
    }
}
