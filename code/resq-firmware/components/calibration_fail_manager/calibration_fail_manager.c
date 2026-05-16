#include "calibration_fail_manager.h"

#include <stdbool.h>
#include <stdio.h>
#include <string.h>

#include "driver/gpio.h"
#include "esp_err.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "board_config.h"
#include "calibration_manager.h"
#include "calibration_codes.h"
#include "mqtt_manager.h"
#include "runtime_helpers.h"
#include "status_indicator.h"
#include "wifi_manager.h"
#include "esp_timer.h"

static const char *TAG = "calibration_fail_mgr";
static bool s_initialized = false;

#ifndef BUTTON_1
#define BUTTON_1 GPIO_NUM_9
#endif

#ifndef BUTTON_2
#define BUTTON_2 GPIO_NUM_1
#endif

esp_err_t calibration_fail_manager_init(void)
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
        ESP_LOGE(TAG, "Failed to configure calibration fail buttons: %s", esp_err_to_name(err));
        return err;
    }

    s_initialized = true;
    return ESP_OK;
}

static bool button_pressed(gpio_num_t gpio)
{
    return gpio_get_level(gpio) == 0;
}

static bool button_pressed_debounced(gpio_num_t gpio)
{
    if (!button_pressed(gpio)) {
        return false;
    }

    vTaskDelay(pdMS_TO_TICKS(50));

    if (!button_pressed(gpio)) {
        return false;
    }

    while (button_pressed(gpio)) {
        vTaskDelay(pdMS_TO_TICKS(20));
    }

    return true;
}

resq_state_t calibration_fail_manager_run(network_config_t *network_config,
                                          calibration_config_t *calibration_config,
                                          const char *ip_address)
{
    if (network_config == NULL || calibration_config == NULL) {
        return RESQ_STATE_ERROR;
    }

    status_indicator_set_state(RESQ_STATE_CALIBRATION_FAIL);

    calibration_reason_id_t reason_id = calibration_manager_get_last_failure_reason();
    calibration_action_id_t action_id = calibration_manager_get_last_failure_action();

    ESP_LOGW(TAG,
             "CALIBRATION_FAIL reason_id=%d reason=%s action_id=%d action=%s",
             (int)reason_id,
             calibration_codes_reason_to_string(reason_id),
             (int)action_id,
             calibration_codes_action_to_string(action_id));

    if (mqtt_manager_is_connected()) {
        mqtt_manager_publish_status(RESQ_STATE_CALIBRATION_FAIL,
                                    network_config,
                                    calibration_config,
                                    false,
                                    "",
                                    ip_address);

        calibration_manager_publish_progress_event(reason_id,
                                                   RESQ_STATE_CALIBRATION_FAIL,
                                                   action_id);
    }

    while (true) {
        if (button_pressed_debounced(BUTTON_1)) {
            ESP_LOGW(TAG, "BUTTON_1 pressed: retry calibration");

            esp_err_t retry_err = calibration_manager_retry_last(network_config);

            if (retry_err == ESP_OK) {
                runtime_helpers_publish_command_result(network_config,
                                                       RESQ_STATE_CALIBRATION_FAIL,
                                                       "button/retry",
                                                       "ACK",
                                                       "retry_calibration");

                return RESQ_STATE_CALIBRATING;
            }

            /* Map retry errors to calibration reason/action */
            calibration_reason_id_t reason = CAL_REASON_CALIBRATION_VALUES_OUT_OF_RANGE;
            calibration_action_id_t action = CAL_ACTION_BUTTON_1_RETRY_BUTTON_2_IDLE;

            if (retry_err == ESP_ERR_NOT_FOUND) {
                reason = CAL_REASON_INVALID_CALIBRATION_PAYLOAD;
                action = CAL_ACTION_SEND_VALID_PAYLOAD;
            } else if (retry_err == ESP_ERR_INVALID_STATE) {
                reason = CAL_REASON_CALIBRATION_ALREADY_RUNNING;
                action = CAL_ACTION_WAIT_OR_CANCEL;
            }

            runtime_helpers_publish_command_result(network_config,
                                                   RESQ_STATE_CALIBRATION_FAIL,
                                                   "button/retry",
                                                   "NACK",
                                                   "retry_failed");

            calibration_manager_publish_progress_event(reason,
                                                       RESQ_STATE_CALIBRATION_FAIL,
                                                       action);
        }

        if (button_pressed_debounced(BUTTON_2)) {
            ESP_LOGW(TAG, "BUTTON_2 pressed: return to paired idle");

            calibration_manager_drop_temporary_values();

            runtime_helpers_publish_command_result(network_config,
                                                   RESQ_STATE_CALIBRATION_FAIL,
                                                   "button/idle",
                                                   "ACK",
                                                   "returning_to_paired_idle");

            return RESQ_STATE_PAIRED_IDLE;
        }

        if (!wifi_manager_is_connected()) {
            calibration_manager_publish_progress_event(CAL_REASON_WIFI_DISCONNECTED_DURING_CALIBRATION,
                                                       RESQ_STATE_CALIBRATION_FAIL,
                                                       CAL_ACTION_BUTTON_1_CONTINUE_BUTTON_2_IDLE);
            return RESQ_STATE_ERROR;
        }

        if (!mqtt_manager_is_connected()) {
            return RESQ_STATE_ERROR;
        }

        resq_mqtt_command_t command = {0};
        esp_err_t wait_err = mqtt_manager_wait_for_command(&command, pdMS_TO_TICKS(250));

        if (wait_err == ESP_ERR_TIMEOUT) {
            continue;
        }

        if (wait_err != ESP_OK) {
            continue;
        }

        const char *suffix = runtime_helpers_get_command_suffix(command.topic);

        if (suffix == NULL) {
            runtime_helpers_publish_command_result(network_config,
                                                   RESQ_STATE_CALIBRATION_FAIL,
                                                   "unknown",
                                                   "NACK",
                                                   "invalid_command_topic");
            continue;
        }

        if (strcmp(suffix, "cmd/calibration/cancel") == 0) {
            calibration_manager_drop_temporary_values();

            runtime_helpers_publish_command_result(network_config,
                                                   RESQ_STATE_CALIBRATION_FAIL,
                                                   "cmd/calibration/cancel",
                                                   "ACK",
                                                   "calibration_cancelled");

            /* publish minimal calibration_result CANCELLED */
            if (mqtt_manager_is_connected()) {
                char payload[512];
                int written = snprintf(payload,
                                       sizeof(payload),
                                       "{"
                                       "\"event_type\":\"calibration_result\"," 
                                       "\"command_id\":\"%s\"," 
                                       "\"status\":\"%s\"," 
                                       "\"result\":\"%s\"," 
                                       "\"reason_id\":%d," 
                                       "\"state\":\"%s\"," 
                                       "\"action_id\":%d," 
                                       "\"ts_ms\":%lld"
                                       "}",
                                       "cmd-005",
                                       "ACK",
                                       "CANCELLED",
                                       (int)CAL_REASON_CALIBRATION_CANCELLED,
                                       resq_state_to_string(RESQ_STATE_PAIRED_IDLE),
                                       (int)CAL_ACTION_MOVE_TO_PAIRED_IDLE_DROP_TEMP,
                                       (long long)(esp_timer_get_time() / 1000));

                if (written > 0 && written < (int)sizeof(payload)) {
                    mqtt_manager_publish_topic_json("events/calibration/result", payload);
                }
            }

            return RESQ_STATE_PAIRED_IDLE;
        }

        if (strcmp(suffix, "cmd/session/start") == 0) {
            runtime_helpers_publish_command_result(network_config,
                                                   RESQ_STATE_CALIBRATION_FAIL,
                                                   "cmd/session/start",
                                                   "NACK",
                                                   "calibration_not_ready");
            continue;
        }

        if (strcmp(suffix, "cmd/debug") == 0) {
            esp_err_t debug_err = runtime_helpers_publish_debug_snapshot(network_config);

            if (debug_err != ESP_OK) {
                runtime_helpers_publish_command_result(network_config,
                                                       RESQ_STATE_CALIBRATION_FAIL,
                                                       "cmd/debug",
                                                       "NACK",
                                                       "debug_read_failed");
                continue;
            }

            runtime_helpers_publish_command_result(network_config,
                                                   RESQ_STATE_CALIBRATION_FAIL,
                                                   "cmd/debug",
                                                   "ACK",
                                                   "debug_published");
            continue;
        }

        if (strcmp(suffix, "cmd/calibration/start") == 0) {
            char command_id[128] = {0};
            calibration_config_t parsed = {0};
            calibration_reason_id_t parse_reason = CAL_REASON_NONE;

            esp_err_t parse_err = calibration_manager_parse_start_payload(command.payload,
                                                                           &parsed,
                                                                           command_id,
                                                                           sizeof(command_id),
                                                                           &parse_reason);

            if (parse_err != ESP_OK) {
                runtime_helpers_publish_command_result(network_config,
                                                       RESQ_STATE_CALIBRATION_FAIL,
                                                       "cmd/calibration/start",
                                                       "NACK",
                                                       "invalid_calibration_payload");

                calibration_manager_publish_progress_event(parse_reason,
                                                           RESQ_STATE_CALIBRATION_FAIL,
                                                           CAL_ACTION_SEND_VALID_PAYLOAD);

                continue;
            }

            if (calibration_manager_is_running()) {
                runtime_helpers_publish_command_result(network_config,
                                                       RESQ_STATE_CALIBRATION_FAIL,
                                                       "cmd/calibration/start",
                                                       "NACK",
                                                       "calibration_already_running");

                calibration_manager_publish_progress_event(CAL_REASON_CALIBRATION_ALREADY_RUNNING,
                                                           RESQ_STATE_CALIBRATING,
                                                           CAL_ACTION_WAIT_OR_CANCEL);
                continue;
            }

            /* Do not erase NVS; just drop temporary values and start new calibration */
            calibration_manager_drop_temporary_values();

            parsed.calibrated = false;

            runtime_helpers_publish_command_result(network_config,
                                                   RESQ_STATE_CALIBRATION_FAIL,
                                                   "cmd/calibration/start",
                                                   "ACK",
                                                   "moving_to_calibrating");

            /* publish result STARTED */
            if (mqtt_manager_is_connected()) {
                char payload[512];
                int written = snprintf(payload,
                                       sizeof(payload),
                                       "{"
                                       "\"event_type\":\"calibration_result\"," 
                                       "\"command_id\":\"%s\"," 
                                       "\"status\":\"%s\"," 
                                       "\"result\":\"%s\"," 
                                       "\"reason_id\":%d," 
                                       "\"state\":\"%s\"," 
                                       "\"action_id\":%d," 
                                       "\"ts_ms\":%lld"
                                       "}",
                                       command_id[0] != '\0' ? command_id : "cmd-003",
                                       "ACK",
                                       "STARTED",
                                       (int)CAL_REASON_NONE,
                                       resq_state_to_string(RESQ_STATE_CALIBRATING),
                                       (int)CAL_ACTION_NONE,
                                       (long long)(esp_timer_get_time() / 1000));

                if (written > 0 && written < (int)sizeof(payload)) {
                    mqtt_manager_publish_topic_json("events/calibration/result", payload);
                }
            }

            esp_err_t start_err = calibration_manager_start(network_config,
                                                            &parsed,
                                                            command_id[0] != '\0' ? command_id : "cmd-003");

            if (start_err != ESP_OK) {
                runtime_helpers_publish_command_result(network_config,
                                                       RESQ_STATE_CALIBRATION_FAIL,
                                                       "cmd/calibration/start",
                                                       "NACK",
                                                       "start_failed");

                calibration_manager_publish_progress_event(CAL_REASON_CALIBRATION_VALUES_OUT_OF_RANGE,
                                                           RESQ_STATE_CALIBRATION_FAIL,
                                                           CAL_ACTION_BUTTON_1_RETRY_BUTTON_2_IDLE);
                continue;
            }

            return RESQ_STATE_CALIBRATING;
        }

        runtime_helpers_publish_command_result(network_config,
                                               RESQ_STATE_CALIBRATION_FAIL,
                                               suffix,
                                               "NACK",
                                               "unknown_command");
    }

    return RESQ_STATE_PAIRED_IDLE;
}
