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
#include "calibration_manager.h"
#include "session_active_manager.h"

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


static void paired_idle_publish_calibration_result(const network_config_t *network_config,
                                                   resq_state_t state,
                                                   const char *command_id,
                                                   const char *status,
                                                   const char *result,
                                                   bool ready_for_session,
                                                   const char *message)
{
    char payload[512];

    int written = snprintf(payload,
                           sizeof(payload),
                           "{"
                           "\"event_type\":\"calibration_result\","
                           "\"device_id\":\"%s\","
                           "\"command_id\":\"%s\","
                           "\"status\":\"%s\","
                           "\"result\":\"%s\","
                           "\"readyForSession\":%s,"
                           "\"state\":\"%s\","
                           "\"message\":\"%s\","
                           "\"ts_ms\":%lld"
                           "}",
                           runtime_helpers_get_device_id(network_config),
                           command_id != NULL ? command_id : "",
                           status != NULL ? status : "",
                           result != NULL ? result : "",
                           ready_for_session ? "true" : "false",
                           resq_state_to_string(state),
                           message != NULL ? message : "",
                           (long long)now_ms());

    if (written <= 0 || written >= (int)sizeof(payload)) {
        ESP_LOGE(TAG, "Calibration result payload too large");
        return;
    }

    if (mqtt_manager_is_connected()) {
        mqtt_manager_publish_topic_json("events/calibration/result", payload);
    }
}

static esp_err_t paired_idle_parse_calibration_start(const char *payload,
                                                    calibration_config_t *calibration_config,
                                                    char *out_command_id,
                                                    size_t out_command_id_len)
{
    if (payload == NULL || calibration_config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    cJSON *root = cJSON_Parse(payload);
    if (root == NULL) {
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
        result = ESP_ERR_INVALID_ARG;
        goto exit;
    }

    /* validate numeric values > 0 */
    if (hall_delta->valuedouble <= 0 || ref_pressure->valuedouble <= 0 ||
        bladder_1_pressure->valuedouble <= 0 || bladder_2_pressure->valuedouble <= 0) {
        result = ESP_ERR_INVALID_ARG;
        goto exit;
    }

    if (out_command_id != NULL && out_command_id_len > 0) {
        strncpy(out_command_id, command_id->valuestring, out_command_id_len - 1);
        out_command_id[out_command_id_len - 1] = '\0';
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


static esp_err_t paired_idle_parse_session_start(const char *payload,
                                                 char *out_command_id,
                                                 size_t command_id_len,
                                                 char *out_session_id,
                                                 size_t session_id_len,
                                                 char *out_profile_id,
                                                 size_t profile_id_len)
{
    if (payload == NULL || out_session_id == NULL) return ESP_ERR_INVALID_ARG;

    cJSON *root = cJSON_Parse(payload);
    if (root == NULL) return ESP_FAIL;

    esp_err_t result = ESP_OK;

    cJSON *command_id = cJSON_GetObjectItemCaseSensitive(root, "command_id");
    cJSON *event_type = cJSON_GetObjectItemCaseSensitive(root, "event_type");
    cJSON *session_id = cJSON_GetObjectItemCaseSensitive(root, "session_id");
    cJSON *sessionId = cJSON_GetObjectItemCaseSensitive(root, "sessionId");
    cJSON *profile_id = cJSON_GetObjectItemCaseSensitive(root, "profile_id");

    if (event_type != NULL && cJSON_IsString(event_type) && event_type->valuestring != NULL) {
        if (strcmp(event_type->valuestring, "session_start") != 0) {
            result = ESP_ERR_INVALID_ARG;
            goto exit;
        }
    }

    const char *sid = NULL;
    if (cJSON_IsString(session_id) && session_id->valuestring != NULL) sid = session_id->valuestring;
    if (sid == NULL && cJSON_IsString(sessionId) && sessionId->valuestring != NULL) sid = sessionId->valuestring;

    if (sid == NULL) {
        result = ESP_ERR_INVALID_ARG;
        goto exit;
    }

    if (out_session_id && session_id_len > 0) {
        strncpy(out_session_id, sid, session_id_len - 1);
        out_session_id[session_id_len - 1] = '\0';
    }

    if (out_command_id != NULL && command_id_len > 0) {
        if (cJSON_IsString(command_id) && command_id->valuestring) {
            strncpy(out_command_id, command_id->valuestring, command_id_len - 1);
            out_command_id[command_id_len - 1] = '\0';
        } else {
            out_command_id[0] = '\0';
        }
    }

    if (out_profile_id != NULL && profile_id_len > 0) {
        if (cJSON_IsString(profile_id) && profile_id->valuestring) {
            strncpy(out_profile_id, profile_id->valuestring, profile_id_len - 1);
            out_profile_id[profile_id_len - 1] = '\0';
        } else {
            out_profile_id[0] = '\0';
        }
    }

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

    resq_state_t visible_state = calibration_config->calibrated
        ? RESQ_STATE_READY_FOR_SESSION
        : RESQ_STATE_PAIRED_IDLE;

    status_indicator_set_state(visible_state);

    /* Publish retained status on entry. */
    mqtt_manager_publish_status(visible_state,
                                network_config,
                                calibration_config,
                                false,
                                "",
                                ip_address);

    while (true) {
        visible_state = calibration_config->calibrated
            ? RESQ_STATE_READY_FOR_SESSION
            : RESQ_STATE_PAIRED_IDLE;

        if (!wifi_manager_is_connected()) {
            runtime_helpers_publish_error_event(network_config,
                                                visible_state,
                                                "WIFI_DISCONNECTED",
                                                "Wi-Fi disconnected while waiting for command");
            return RESQ_STATE_ERROR;
        }

        if (!mqtt_manager_is_connected()) {
            runtime_helpers_publish_error_event(network_config,
                                                visible_state,
                                                "MQTT_DISCONNECTED",
                                                "MQTT disconnected while waiting for command");
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
                                                visible_state,
                                                "COMMAND_WAIT_FAILED",
                                                "Failed while waiting for MQTT command");
            return RESQ_STATE_ERROR;
        }

        const char *command_suffix = runtime_helpers_get_command_suffix(command.topic);

        if (command_suffix == NULL) {
            runtime_helpers_publish_command_result(network_config,
                                                   visible_state,
                                                   "unknown",
                                                   "NACK",
                                                   "invalid_command_topic");
            runtime_helpers_publish_error_event(network_config,
                                                visible_state,
                                                "INVALID_COMMAND_TOPIC",
                                                "Command topic does not contain /cmd/");
            continue;
        }

        ESP_LOGI(TAG, "Command suffix=%s visible_state=%s",
                 command_suffix,
                 resq_state_to_string(visible_state));

        if (strcmp(command_suffix, "cmd/debug") == 0) {
            esp_err_t debug_err = paired_idle_handle_debug(network_config);

            if (debug_err != ESP_OK) {
                runtime_helpers_publish_error_event(network_config,
                                                    visible_state,
                                                    "DEBUG_READ_FAILED",
                                                    "Failed to read or publish debug raw values");
                return RESQ_STATE_ERROR;
            }

            runtime_helpers_publish_command_result(network_config,
                                                   visible_state,
                                                   "cmd/debug",
                                                   "ACK",
                                                   "debug_published");
            continue;
        }

        if (strcmp(command_suffix, "cmd/calibration/cancel") == 0) {
            runtime_helpers_publish_command_result(network_config,
                                                   visible_state,
                                                   "cmd/calibration/cancel",
                                                   "ACK",
                                                   "no_active_calibration");

            paired_idle_publish_calibration_result(network_config,
                                                   visible_state,
                                                   "cmd-005",
                                                   "ACK",
                                                   "CANCELLED",
                                                   calibration_config->calibrated,
                                                   "no_active_calibration");
            continue;
        }

        if (strcmp(command_suffix, "cmd/session/start") == 0) {
            char command_id[128] = {0};
            char session_id[128] = {0};
            char profile_id[128] = {0};

            esp_err_t parse_err = paired_idle_parse_session_start(command.payload,
                                                                  command_id,
                                                                  sizeof(command_id),
                                                                  session_id,
                                                                  sizeof(session_id),
                                                                  profile_id,
                                                                  sizeof(profile_id));

            if (parse_err != ESP_OK) {
                runtime_helpers_publish_command_result(network_config,
                                                       visible_state,
                                                       "cmd/session/start",
                                                       "NACK",
                                                       "invalid_session_start_payload");
                runtime_helpers_publish_error_event(network_config,
                                                    visible_state,
                                                    "INVALID_SESSION_START_PAYLOAD",
                                                    "invalid_session_start_payload");
                continue;
            }

            if (!calibration_config->calibrated) {
                runtime_helpers_publish_command_result(network_config,
                                                       visible_state,
                                                       "cmd/session/start",
                                                       "NACK",
                                                       "calibration_not_ready");
                continue;
            }

            /* attempt to start active session */
            resq_state_t start_state = session_active_manager_start(network_config,
                                                                    calibration_config,
                                                                    ip_address,
                                                                    session_id,
                                                                    profile_id,
                                                                    command_id[0] ? command_id : NULL);

            if (start_state == RESQ_STATE_SESSION_ACTIVE) {
                return RESQ_STATE_SESSION_ACTIVE;
            }

            /* otherwise stay in current visible state */
            continue;
        }

        if (strcmp(command_suffix, "cmd/calibration/start") == 0) {
            char command_id[128] = {0};
            esp_err_t parse_err = paired_idle_parse_calibration_start(command.payload,
                                                                     calibration_config,
                                                                     command_id,
                                                                     sizeof(command_id));

            if (parse_err != ESP_OK) {
                runtime_helpers_publish_command_result(network_config,
                                                       visible_state,
                                                       "cmd/calibration/start",
                                                       "NACK",
                                                       "invalid_calibration_payload");

                paired_idle_publish_calibration_result(network_config,
                                                       visible_state,
                                                       command_id[0] != '\0' ? command_id : "cmd-003",
                                                       "NACK",
                                                       "FAIL",
                                                       false,
                                                       "invalid_calibration_payload");

                runtime_helpers_publish_error_event(network_config,
                                                    visible_state,
                                                    "INVALID_CALIBRATION_PAYLOAD",
                                                    "invalid_calibration_payload");
                continue;
            }

            calibration_config->calibrated = false;

            runtime_helpers_publish_command_result(network_config,
                                                   visible_state,
                                                   "cmd/calibration/start",
                                                   "ACK",
                                                   "moving_to_calibrating");

            paired_idle_publish_calibration_result(network_config,
                                                   visible_state,
                                                   command_id,
                                                   "ACK",
                                                   "STARTED",
                                                   false,
                                                   "moving_to_calibrating");

            esp_err_t start_err = calibration_manager_start(network_config,
                                                            calibration_config,
                                                            command_id);

            if (start_err != ESP_OK) {
                runtime_helpers_publish_command_result(network_config,
                                                       visible_state,
                                                       "cmd/calibration/start",
                                                       "NACK",
                                                       "calibration_start_failed");

                paired_idle_publish_calibration_result(network_config,
                                                       visible_state,
                                                       command_id,
                                                       "NACK",
                                                       "FAIL",
                                                       false,
                                                       "calibration_start_failed");
                continue;
            }

            return RESQ_STATE_CALIBRATING;
        }

        runtime_helpers_publish_command_result(network_config,
                                               visible_state,
                                               command_suffix,
                                               "NACK",
                                               "unknown_command");

        runtime_helpers_publish_error_event(network_config,
                                            visible_state,
                                            "UNKNOWN_COMMAND",
                                            command_suffix);
    }
}
