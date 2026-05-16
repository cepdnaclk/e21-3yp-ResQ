#include "error_manager.h"

#include <stdbool.h>
#include <string.h>

#include "driver/gpio.h"
#include "esp_err.h"
#include "esp_log.h"

#include "esp_timer.h"
#include "error_codes.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "board_config.h"
#include "config_store.h"
#include "mqtt_manager.h"
#include "runtime_helpers.h"
#include "status_indicator.h"

#ifndef BUTTON_1
#define BUTTON_1 GPIO_NUM_9
#endif

#ifndef BUTTON_2
#define BUTTON_2 GPIO_NUM_1
#endif

static const char *TAG = "error_manager";
static bool s_initialized = false;

static firmware_error_reason_id_t s_last_error_reason = FW_ERROR_UNKNOWN_ERROR;
static firmware_error_action_id_t s_last_error_action = FW_ACTION_BUTTON_1_RESTART_BUTTON_2_PROVISIONING;

esp_err_t error_manager_init(void)
{
    if (s_initialized) {
        return ESP_OK;
    }
    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << BUTTON_1) | (1ULL << BUTTON_2),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };

    esp_err_t err = gpio_config(&io_conf);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to configure BUTTON_1 GPIO: %s", esp_err_to_name(err));
        return err;
    }

    s_initialized = true;
    ESP_LOGI(TAG, "Error manager initialized on BUTTON_1 GPIO=%d", BUTTON_1);

    return ESP_OK;
}

static bool button_is_pressed(void)
{
    return gpio_get_level(BUTTON_1) == 0;
}

static bool button2_is_pressed(void)
{
    return gpio_get_level(BUTTON_2) == 0;
}

esp_err_t error_manager_set_error(firmware_error_reason_id_t reason_id)
{
    s_last_error_reason = reason_id;
    s_last_error_action = error_codes_default_action_for_reason(reason_id);

    ESP_LOGE(TAG,
             "Firmware error reason_id=%d reason=%s action_id=%d action=%s",
             (int)s_last_error_reason,
             error_codes_reason_to_string(s_last_error_reason),
             (int)s_last_error_action,
             error_codes_action_to_string(s_last_error_action));

    return ESP_OK;
}

firmware_error_reason_id_t error_manager_get_last_reason(void)
{
    return s_last_error_reason;
}

firmware_error_action_id_t error_manager_get_last_action(void)
{
    return s_last_error_action;
}

esp_err_t error_manager_publish_error_event(const network_config_t *network_config,
                                            firmware_error_reason_id_t reason_id,
                                            resq_state_t state,
                                            firmware_error_action_id_t action_id)
{
    (void)network_config;

    char payload[192];

    int written = snprintf(payload,
                           sizeof(payload),
                           "{"
                           "\"event_type\":\"firmware_error\","
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
        ESP_LOGE(TAG, "Firmware error payload too large");
        return ESP_ERR_INVALID_SIZE;
    }

    if (!mqtt_manager_is_connected()) {
        return ESP_ERR_INVALID_STATE;
    }

    return mqtt_manager_publish_topic_json("events/error", payload);
}

resq_state_t error_manager_run(network_config_t *network_config,
                               calibration_config_t *calibration_config,
                               const char *ip_address)
{
    ESP_LOGE(TAG, "Entered ERROR state");

    status_indicator_set_state(RESQ_STATE_ERROR);

    /* Publish minimal firmware error event if possible */
    if (mqtt_manager_is_connected() && network_config != NULL) {
        error_manager_publish_error_event(network_config,
                                          s_last_error_reason,
                                          RESQ_STATE_ERROR,
                                          s_last_error_action);

        /* Publish retained status including last_error_id if MQTT manager supports it */
        /* Use mqtt_manager_publish_error_status if available, fall back to publish_status */
        extern esp_err_t mqtt_manager_publish_error_status(resq_state_t state,
                                                          const network_config_t *network_config,
                                                          const calibration_config_t *calibration_config,
                                                          bool session_active,
                                                          const char *session_id,
                                                          const char *ip,
                                                          int last_error_id);

        mqtt_manager_publish_error_status(RESQ_STATE_ERROR,
                                              network_config,
                                              calibration_config,
                                              false,
                                              "",
                                              ip_address != NULL ? ip_address : "",
                                              (int)s_last_error_reason);
    }

    /* Wait for user button or system commands */
    while (true) {
        /* Check button 1 (retry) */
        if (button_is_pressed()) {
            vTaskDelay(pdMS_TO_TICKS(50));
            if (button_is_pressed()) {
                ESP_LOGW(TAG, "BUTTON_1 pressed. Retry requested.");

                if (mqtt_manager_is_connected() && network_config != NULL) {
                    runtime_helpers_publish_command_result(network_config,
                                                           RESQ_STATE_ERROR,
                                                           "button/retry",
                                                           "ACK",
                                                           "retry_error_recovery");
                }

                return error_manager_get_retry_state();
            }
        }

        /* Check button 2 (flush config / provisioning) */
        if (button2_is_pressed()) {
            vTaskDelay(pdMS_TO_TICKS(50));
            if (button2_is_pressed()) {
                ESP_LOGW(TAG, "BUTTON_2 pressed. Clear config requested.");

                if (mqtt_manager_is_connected() && network_config != NULL) {
                    runtime_helpers_publish_command_result(network_config,
                                                           RESQ_STATE_ERROR,
                                                           "button/provisioning",
                                                           "ACK",
                                                           "clear_config_and_provision");
                }

                return RESQ_STATE_FLUSH_CONFIG;
            }
        }

        /* Handle MQTT commands while in ERROR if connected */
        if (mqtt_manager_is_connected()) {
            resq_mqtt_command_t command = {0};
            esp_err_t wait_err = mqtt_manager_wait_for_command(&command, pdMS_TO_TICKS(250));

            if (wait_err == ESP_OK) {
                const char *suffix = runtime_helpers_get_command_suffix(command.topic);

                if (suffix == NULL) {
                    runtime_helpers_publish_command_result(network_config,
                                                           RESQ_STATE_ERROR,
                                                           "unknown",
                                                           "NACK",
                                                           "invalid_command_topic");
                    continue;
                }

                ESP_LOGI(TAG, "ERROR state command=%s", suffix);

                if (strcmp(suffix, "cmd/system/retry") == 0) {
                    runtime_helpers_publish_command_result(network_config,
                                                           RESQ_STATE_ERROR,
                                                           "cmd/system/retry",
                                                           "ACK",
                                                           "retry_requested");
                    return error_manager_get_retry_state();
                }

                if (strcmp(suffix, "cmd/system/reset") == 0) {
                    runtime_helpers_publish_command_result(network_config,
                                                           RESQ_STATE_ERROR,
                                                           "cmd/system/reset",
                                                           "ACK",
                                                           "reset_requested");
                    return RESQ_STATE_RESETTING;
                }

                if (strcmp(suffix, "cmd/system/flush-config") == 0) {
                    runtime_helpers_publish_command_result(network_config,
                                                           RESQ_STATE_ERROR,
                                                           "cmd/system/flush-config",
                                                           "ACK",
                                                           "flush_config_requested");
                    return RESQ_STATE_FLUSH_CONFIG;
                }

                if (strcmp(suffix, "cmd/debug") == 0) {
                    esp_err_t dbg_err = runtime_helpers_publish_debug_snapshot(network_config);
                    if (dbg_err == ESP_OK) {
                        runtime_helpers_publish_command_result(network_config,
                                                               RESQ_STATE_ERROR,
                                                               "cmd/debug",
                                                               "ACK",
                                                               "debug_published");
                    } else {
                        runtime_helpers_publish_command_result(network_config,
                                                               RESQ_STATE_ERROR,
                                                               "cmd/debug",
                                                               "NACK",
                                                               "debug_not_available_in_error_state");
                    }
                    continue;
                }

                if (strcmp(suffix, "cmd/calibration/start") == 0 || strcmp(suffix, "cmd/session/start") == 0) {
                    runtime_helpers_publish_command_result(network_config,
                                                           RESQ_STATE_ERROR,
                                                           suffix,
                                                           "NACK",
                                                           "device_in_error");
                    continue;
                }

                /* Unknown command */
                runtime_helpers_publish_command_result(network_config,
                                                       RESQ_STATE_ERROR,
                                                       suffix,
                                                       "NACK",
                                                       "unknown_command");
            }
        }

        vTaskDelay(pdMS_TO_TICKS(100));
    }
}

resq_state_t error_manager_get_retry_state(void)
{
    switch (s_last_error_reason) {
        case FW_ERROR_WIFI_CONNECT_FAILED:
        case FW_ERROR_WIFI_DISCONNECTED_UNRECOVERABLE:
        case FW_ERROR_WIFI_NO_IP_ASSIGNED:
            return RESQ_STATE_WIFI_CONNECTING;

        case FW_ERROR_BACKEND_REGISTER_FAILED:
        case FW_ERROR_BACKEND_INVALID_RESPONSE:
        case FW_ERROR_BACKEND_DEVICE_REJECTED:
            return RESQ_STATE_BACKEND_REGISTERING;

        case FW_ERROR_MQTT_CONNECT_FAILED:
        case FW_ERROR_MQTT_DISCONNECTED_UNRECOVERABLE:
        case FW_ERROR_MQTT_SUBSCRIBE_FAILED:
        case FW_ERROR_MQTT_PUBLISH_FAILED:
            return RESQ_STATE_MQTT_CONNECTING;

        case FW_ERROR_HX710_INIT_FAILED:
        case FW_ERROR_HX710_READ_FAILED:
        case FW_ERROR_HALL_SENSOR_INIT_FAILED:
        case FW_ERROR_HALL_SENSOR_READ_FAILED:
        case FW_ERROR_SENSOR_RUNTIME_FAILED:
            return RESQ_STATE_PAIRED_IDLE;

        case FW_ERROR_SESSION_START_FAILED:
        case FW_ERROR_TELEMETRY_TASK_FAILED:
        case FW_ERROR_BUZZER_TASK_FAILED:
        case FW_ERROR_SESSION_INTERRUPTED_UNRECOVERABLE:
            return RESQ_STATE_READY_FOR_SESSION;

        case FW_ERROR_NVS_LOAD_FAILED:
        case FW_ERROR_CONFIG_INVALID:
            return RESQ_STATE_FLUSH_CONFIG;

        case FW_ERROR_NVS_INIT_FAILED:
        case FW_ERROR_TASK_CREATE_FAILED:
        case FW_ERROR_QUEUE_CREATE_FAILED:
        case FW_ERROR_MUTEX_CREATE_FAILED:
        case FW_ERROR_MEMORY_ALLOCATION_FAILED:
        case FW_ERROR_FIRMWARE_ASSERT_FAILED:
        case FW_ERROR_UNKNOWN_ERROR:
        case FW_ERROR_INVALID_STATE_TRANSITION:
        case FW_ERROR_UNSUPPORTED_STATE:
        default:
            return RESQ_STATE_RESETTING;
    }
}
