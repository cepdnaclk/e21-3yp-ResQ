#include "calibration_fail_manager.h"

#include <stdbool.h>
#include <stdio.h>
#include <string.h>

#include "system_button_manager.h"
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
#include "telemetry_publisher.h"

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
    s_initialized = true;
    ESP_LOGI(TAG, "Calibration fail manager initialized (button GPIOs managed by system_button_manager)");
    return ESP_OK;
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
                               action_id,
                               12);
    }

    while (true) {
        system_button_event_t button_event = {0};

        if (system_button_manager_wait_event(&button_event, pdMS_TO_TICKS(50)) == ESP_OK) {
            if (button_event.press_type == SYSTEM_BUTTON_PRESS_SHORT &&
                button_event.button_id == SYSTEM_BUTTON_ID_1) {

                ESP_LOGW(TAG,
                         "BUTTON_1 short press: retry calibration duration=%lu ms",
                         (unsigned long)button_event.duration_ms);

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
                                                           action,
                                                           12);
            }

            if (button_event.press_type == SYSTEM_BUTTON_PRESS_SHORT &&
                button_event.button_id == SYSTEM_BUTTON_ID_2) {

                ESP_LOGW(TAG,
                         "BUTTON_2 short press: return to paired idle duration=%lu ms",
                         (unsigned long)button_event.duration_ms);

                telemetry_publisher_stop_sensor_stream();
                calibration_manager_drop_temporary_values();

                runtime_helpers_publish_command_result(network_config,
                                                       RESQ_STATE_CALIBRATION_FAIL,
                                                       "button/idle",
                                                       "ACK",
                                                       "returning_to_paired_idle");

                return RESQ_STATE_PAIRED_IDLE;
            }

            if (button_event.press_type == SYSTEM_BUTTON_PRESS_LONG &&
                button_event.button_id == SYSTEM_BUTTON_ID_1) {

                ESP_LOGW(TAG,
                         "BUTTON_1 long press in CALIBRATION_FAIL: TURN_OFF duration=%lu ms",
                         (unsigned long)button_event.duration_ms);

                telemetry_publisher_stop_sensor_stream();
                return RESQ_STATE_TURN_OFF;
            }

            if (button_event.press_type == SYSTEM_BUTTON_PRESS_LONG &&
                button_event.button_id == SYSTEM_BUTTON_ID_2) {
                ESP_LOGW(TAG,
                         "BUTTON_2 long press in CALIBRATION_FAIL ignored; use short press to return idle");
            }
        }

        if (!wifi_manager_is_connected()) {
            telemetry_publisher_stop_sensor_stream();
            calibration_manager_publish_progress_event(CAL_REASON_WIFI_DISCONNECTED_DURING_CALIBRATION,
                                                       RESQ_STATE_CALIBRATION_FAIL,
                                                       CAL_ACTION_BUTTON_1_CONTINUE_BUTTON_2_IDLE,
                                                       12);
            return RESQ_STATE_ERROR;
        }

        if (!mqtt_manager_is_connected()) {
            telemetry_publisher_stop_sensor_stream();
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
            runtime_helpers_publish_command_result_from_command(network_config,
                                                                RESQ_STATE_CALIBRATION_FAIL,
                                                                &command,
                                                                "unknown",
                                                                "NACK",
                                                                "invalid_command_topic");
            continue;
        }

        if (strcmp(suffix, RESQ_SUFFIX_CMD_TELEMETRY) == 0) {
            telemetry_publisher_handle_sensor_stream_command(network_config,
                                                             RESQ_STATE_CALIBRATION_FAIL,
                                                             calibration_config,
                                                             &command,
                                                             true);
            continue;
        }

        if (strcmp(suffix, "cmd/calibration/cancel") == 0) {
            char reply_id[128] = {0};
            if (resq_command_extract_request_id(command.payload, reply_id, sizeof(reply_id)) != ESP_OK) {
                ESP_LOGW(TAG, "Missing request_id for cmd/calibration/cancel; skipping cancel");
                continue;
            }

            calibration_manager_drop_temporary_values();

            esp_err_t pub_err = runtime_helpers_publish_command_result_from_command(network_config,
                                                                                      RESQ_STATE_CALIBRATION_FAIL,
                                                                                      &command,
                                                                                      "cmd/calibration/cancel",
                                                                                      "ACK",
                                                                                      "calibration_cancelled");
            if (pub_err != ESP_OK) {
                ESP_LOGW(TAG, "Failed to publish command result for cmd/calibration/cancel; skipping cancel (err=%d)", pub_err);
                continue;
            }

            /* publish minimal calibration_result CANCELLED */
            calibration_manager_publish_calibration_result(reply_id,
                                                           "ACK",
                                                           "CANCELLED",
                                                           CAL_REASON_CALIBRATION_CANCELLED,
                                                           RESQ_STATE_PAIRED_IDLE,
                                                           CAL_ACTION_MOVE_TO_PAIRED_IDLE_DROP_TEMP);

            return RESQ_STATE_PAIRED_IDLE;
        }

        if (strcmp(suffix, "cmd/session/start") == 0) {
            runtime_helpers_publish_command_result_from_command(network_config,
                                                                RESQ_STATE_CALIBRATION_FAIL,
                                                                &command,
                                                                "cmd/session/start",
                                                                "NACK",
                                                                "calibration_not_ready");
            continue;
        }

        if (strcmp(suffix, "cmd/debug") == 0) {
            esp_err_t debug_err = runtime_helpers_publish_debug_snapshot(network_config);

            if (debug_err != ESP_OK) {
                runtime_helpers_publish_command_result_from_command(network_config,
                                                                    RESQ_STATE_CALIBRATION_FAIL,
                                                                    &command,
                                                                    "cmd/debug",
                                                                    "NACK",
                                                                    "debug_read_failed");
                continue;
            }

            runtime_helpers_publish_command_result_from_command(network_config,
                                                                RESQ_STATE_CALIBRATION_FAIL,
                                                                &command,
                                                                "cmd/debug",
                                                                "ACK",
                                                                "debug_published");
            continue;
        }

        if (strcmp(suffix, "cmd/calibration/start") == 0) {
            char command_id[128] = {0};
            calibration_config_t parsed = {0};
            calibration_reason_id_t parse_reason = CAL_REASON_NONE;

            /* Require request_id before starting calibration */
            char reply_id[128] = {0};
            if (resq_command_extract_request_id(command.payload, reply_id, sizeof(reply_id)) != ESP_OK) {
                ESP_LOGW(TAG, "Missing request_id for cmd/calibration/start; skipping calibration start");
                continue;
            }

            esp_err_t parse_err = calibration_manager_parse_start_payload(command.payload,
                                                                           &parsed,
                                                                           command_id,
                                                                           sizeof(command_id),
                                                                           &parse_reason);

            if (parse_err != ESP_OK) {
                runtime_helpers_publish_command_result_from_command(network_config,
                                                                    RESQ_STATE_CALIBRATION_FAIL,
                                                                    &command,
                                                                    "cmd/calibration/start",
                                                                    "NACK",
                                                                    "invalid_calibration_payload");

                calibration_manager_publish_progress_event(parse_reason,
                                                           RESQ_STATE_CALIBRATION_FAIL,
                                                           CAL_ACTION_SEND_VALID_PAYLOAD,
                                                           0);

                continue;
            }

            if (calibration_manager_is_running()) {
                runtime_helpers_publish_command_result_from_command(network_config,
                                                                    RESQ_STATE_CALIBRATION_FAIL,
                                                                    &command,
                                                                    "cmd/calibration/start",
                                                                    "NACK",
                                                                    "calibration_already_running");

                calibration_manager_publish_progress_event(CAL_REASON_CALIBRATION_ALREADY_RUNNING,
                                       RESQ_STATE_CALIBRATING,
                                       CAL_ACTION_WAIT_OR_CANCEL,
                                       0);
                continue;
            }

            /* Do not erase NVS; just drop temporary values and start new calibration */
            calibration_manager_drop_temporary_values();

            parsed.calibrated = false;

            esp_err_t stream_stop_err = telemetry_publisher_stop_sensor_stream();
            if (stream_stop_err != ESP_OK) {
                runtime_helpers_publish_command_result_from_command(network_config,
                                                                    RESQ_STATE_CALIBRATION_FAIL,
                                                                    &command,
                                                                    "cmd/calibration/start",
                                                                    "NACK",
                                                                    "07102");
                continue;
            }

            esp_err_t pub_err = runtime_helpers_publish_command_result_from_command(network_config,
                                                                                      RESQ_STATE_CALIBRATION_FAIL,
                                                                                      &command,
                                                                                      "cmd/calibration/start",
                                                                                      "ACK",
                                                                                      "moving_to_calibrating");
            if (pub_err != ESP_OK) {
                ESP_LOGW(TAG, "Failed to publish command result for cmd/calibration/start; skipping calibration start (err=%d)", pub_err);
                continue;
            }

            /* publish result STARTED and store request id */
            calibration_manager_set_request_id(reply_id);
            calibration_manager_publish_calibration_result(reply_id,
                                                           "ACK",
                                                           "STARTED",
                                                           CAL_REASON_NONE,
                                                           RESQ_STATE_CALIBRATING,
                                                           CAL_ACTION_NONE);

            esp_err_t start_err = calibration_manager_start(network_config,
                                                            &parsed,
                                                            command_id[0] != '\0' ? command_id : NULL);

            if (start_err != ESP_OK) {
                runtime_helpers_publish_command_result_from_command(network_config,
                                                                    RESQ_STATE_CALIBRATION_FAIL,
                                                                    &command,
                                                                    "cmd/calibration/start",
                                                                    "NACK",
                                                                    "start_failed");

                calibration_manager_publish_progress_event(CAL_REASON_CALIBRATION_VALUES_OUT_OF_RANGE,
                                                           RESQ_STATE_CALIBRATION_FAIL,
                                                           CAL_ACTION_BUTTON_1_RETRY_BUTTON_2_IDLE,
                                                           12);
                continue;
            }

            return RESQ_STATE_CALIBRATING;
        }

        runtime_helpers_publish_command_result_from_command(network_config,
                                    RESQ_STATE_CALIBRATION_FAIL,
                                    &command,
                                    suffix,
                                    "NACK",
                                    "unknown_command");
    }

    return RESQ_STATE_PAIRED_IDLE;
}
