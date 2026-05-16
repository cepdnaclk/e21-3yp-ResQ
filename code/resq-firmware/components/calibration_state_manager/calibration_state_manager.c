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

static const char *TAG = "calibration_state_manager";

static int64_t now_ms(void)
{
    return esp_timer_get_time() / 1000;
}

static void publish_calibration_result(const char *command_id,
                                       const char *status,
                                       const char *result,
                                       calibration_reason_id_t reason_id,
                                       resq_state_t state,
                                       calibration_action_id_t action_id)
{
    char payload[320];

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
                           command_id != NULL ? command_id : "",
                           status != NULL ? status : "",
                           result != NULL ? result : "",
                           (int)reason_id,
                           resq_state_to_string(state),
                           (int)action_id,
                           (long long)now_ms());

    if (written <= 0 || written >= (int)sizeof(payload)) {
        ESP_LOGE(TAG, "Calibration result payload too large");
        return;
    }

    if (mqtt_manager_is_connected()) {
        mqtt_manager_publish_topic_json("events/calibration/result", payload);
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
        resq_mqtt_command_t command;

        if (mqtt_manager_wait_for_command(&command, pdMS_TO_TICKS(250)) == ESP_OK) {
            const char *suffix = runtime_helpers_get_command_suffix(command.topic);

            if (suffix != NULL && strcmp(suffix, "cmd/calibration/cancel") == 0) {
                ESP_LOGW(TAG, "Calibration cancelled by command");

                calibration_manager_cancel();

                runtime_helpers_publish_command_result(network_config,
                                                       RESQ_STATE_CALIBRATING,
                                                       "cmd/calibration/cancel",
                                                       "ACK",
                                                       "calibration_cancelled");

                publish_calibration_result(calibration_manager_get_command_id(),
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

            runtime_helpers_publish_error_event(network_config,
                                                RESQ_STATE_CALIBRATING,
                                                "MQTT_DISCONNECTED_DURING_CALIBRATION",
                                                "MQTT disconnected during calibration");

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
