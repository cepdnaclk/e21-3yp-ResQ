#include "calibration_state_manager.h"

#include <stdbool.h>
#include <stdio.h>
#include <string.h>

#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "calibration_manager.h"
#include "mqtt_manager.h"
#include "runtime_helpers.h"
#include "status_indicator.h"
#include "error_manager.h"
#include "system_button_manager.h"

static const char *TAG = "calibration_state_manager";

static void publish_calibration_result(const char *command_id,
                                       const char *status,
                                       const char *result,
                                       calibration_reason_id_t reason_id,
                                       resq_state_t state,
                                       calibration_action_id_t action_id)
{
    /* Prefer stored request_id from calibration_manager; fall back to provided command_id for compatibility */
    const char *reply_id = calibration_manager_get_request_id();
    if (reply_id == NULL || reply_id[0] == '\0') {
        reply_id = command_id != NULL ? command_id : "";
    }

    esp_err_t err = calibration_manager_publish_calibration_result(reply_id,
                                                                   status,
                                                                   result,
                                                                   reason_id,
                                                                   state,
                                                                   action_id);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "Failed to publish calibration result (reply_id=%s) err=%d", reply_id, err);
    }
}

resq_state_t calibration_state_manager_run(network_config_t *network_config,
                                           calibration_config_t *calibration_config,
                                           const char *ip_address)
{
    if (network_config == NULL || calibration_config == NULL) {
        return RESQ_STATE_ERROR;
    }

    ESP_LOGI(TAG, "Entering CALIBRATING state");

    status_indicator_set_state(RESQ_STATE_CALIBRATING);

    if (mqtt_manager_is_connected()) {
        mqtt_manager_publish_status(RESQ_STATE_CALIBRATING,
                                    network_config,
                                    calibration_config,
                                    false,
                                    "",
                                    ip_address);
    }

    while (calibration_manager_is_running()) {
        system_button_action_t action = system_button_manager_poll(RESQ_STATE_CALIBRATING);
        if (action == SYSTEM_BUTTON_ACTION_TURN_OFF) {
            ESP_LOGW(TAG, "System button requested TURN_OFF during calibration");
            return RESQ_STATE_TURN_OFF;
        }

        if (action == SYSTEM_BUTTON_ACTION_FACTORY_RESET) {
            ESP_LOGW(TAG, "System button requested FACTORY_RESET during calibration");
            return RESQ_STATE_RESETTING;
        }
        resq_mqtt_command_t command;

        if (mqtt_manager_wait_for_command(&command, pdMS_TO_TICKS(250)) == ESP_OK) {
            const char *suffix = runtime_helpers_get_command_suffix(command.topic);

            if (suffix != NULL && strcmp(suffix, "cmd/calibration/cancel") == 0) {
                ESP_LOGW(TAG, "Calibration cancelled by command");

                char reply_id[128] = {0};
                if (resq_command_extract_request_id(command.payload, reply_id, sizeof(reply_id)) != ESP_OK) {
                    ESP_LOGW(TAG, "Missing request_id for cmd/calibration/cancel; skipping cancel");
                    continue;
                }

                /* publish ACK and check result before cancelling */
                esp_err_t pub_err = runtime_helpers_publish_command_result_from_command(network_config,
                                                                                          RESQ_STATE_CALIBRATING,
                                                                                          &command,
                                                                                          "cmd/calibration/cancel",
                                                                                          "ACK",
                                                                                          "calibration_cancelled");
                if (pub_err != ESP_OK) {
                    ESP_LOGW(TAG, "Failed to publish command result for cmd/calibration/cancel; skipping cancel (err=%d)", pub_err);
                    continue;
                }

                calibration_manager_cancel();

                publish_calibration_result(reply_id,
                                           "ACK",
                                           "CANCELLED",
                                           CAL_REASON_CALIBRATION_CANCELLED,
                                           RESQ_STATE_PAIRED_IDLE,
                                           CAL_ACTION_MOVE_TO_PAIRED_IDLE_DROP_TEMP);

                status_indicator_set_state(RESQ_STATE_PAIRED_IDLE);

                if (mqtt_manager_is_connected()) {
                    mqtt_manager_publish_status(RESQ_STATE_PAIRED_IDLE,
                                                network_config,
                                                calibration_config,
                                                false,
                                                "",
                                                ip_address);
                }

                return RESQ_STATE_PAIRED_IDLE;
            }

            ESP_LOGW(TAG,
                     "Ignoring command during calibration topic=%s",
                     command.topic);
        }

        if (!mqtt_manager_is_connected()) {
            ESP_LOGE(TAG, "MQTT disconnected during calibration");
            calibration_manager_cancel();

            error_manager_set_error(FW_ERROR_MQTT_DISCONNECTED_UNRECOVERABLE);
            return RESQ_STATE_ERROR;
        }
    }

    calibration_manager_get_config(calibration_config);

    const char *cmd_id = calibration_manager_get_command_id();

        if (calibration_manager_is_ready()) {
        ESP_LOGI(TAG, "Calibration completed successfully");

        status_indicator_set_state(RESQ_STATE_READY_FOR_SESSION);

        publish_calibration_result(cmd_id,
                                   "ACK",
                                   "PASS",
                                   CAL_REASON_NONE,
                                   RESQ_STATE_READY_FOR_SESSION,
                                   CAL_ACTION_NONE);

        if (mqtt_manager_is_connected()) {
            mqtt_manager_publish_status(RESQ_STATE_READY_FOR_SESSION,
                                        network_config,
                                        calibration_config,
                                        false,
                                        "",
                                        ip_address);
        }

        return RESQ_STATE_READY_FOR_SESSION;
    }

    ESP_LOGW(TAG, "Calibration failed");

    status_indicator_set_state(RESQ_STATE_CALIBRATION_FAIL);

    publish_calibration_result(cmd_id,
                               "NACK",
                               "FAIL",
                               calibration_manager_get_last_failure_reason(),
                               RESQ_STATE_CALIBRATION_FAIL,
                               calibration_manager_get_last_failure_action());

    if (mqtt_manager_is_connected()) {
        mqtt_manager_publish_status(RESQ_STATE_CALIBRATION_FAIL,
                                    network_config,
                                    calibration_config,
                                    false,
                                    "",
                                    ip_address);
    }

    return RESQ_STATE_CALIBRATION_FAIL;
}
