#include "runtime_helpers.h"

#include <stdio.h>
#include <string.h>

#include "esp_log.h"
#include "esp_timer.h"

#include "cJSON.h"

#include "mqtt_manager.h"
#include "config_store.h"
#include "board_config.h"
#include "hx710.h"
#include "hall_sensor.h"
#include "sensor_conversion.h"
#include "esp_timer.h"

static const char *TAG = "runtime_helpers";

static bool runtime_helpers_is_blank(const char *value)
{
    return value == NULL || value[0] == '\0';
}

static bool runtime_helpers_is_reason_id(const char *value)
{
    if (runtime_helpers_is_blank(value)) {
        return false;
    }

    for (const char *p = value; *p != '\0'; ++p) {
        if (*p < '0' || *p > '9') {
            return false;
        }
    }

    return true;
}

static int64_t runtime_helpers_now_ms(void)
{
    return esp_timer_get_time() / 1000;
}

static esp_err_t copy_request_id_if_fits(const char *value, char *out, size_t out_len)
{
    if (strlen(value) >= out_len) {
        return ESP_ERR_INVALID_SIZE;
    }

    strcpy(out, value);
    return ESP_OK;
}

const char *runtime_helpers_get_device_id(const network_config_t *config)
{
    (void)config;

    const char *did = mqtt_manager_get_device_id();
    if (did && did[0] != '\0') {
        return did;
    }

    static char macbuf[RESQ_DEVICE_MAC_MAX_LEN] = {0};
    if (config_store_get_device_mac(macbuf, sizeof(macbuf)) == ESP_OK && macbuf[0] != '\0') {
        return macbuf;
    }

    return "unknown";
}

const char *runtime_helpers_get_command_suffix(const char *topic)
{
    if (topic == NULL) {
        return NULL;
    }

    const char *cmd_pos = strstr(topic, "/cmd/");
    if (cmd_pos == NULL) {
        return NULL;
    }

    return cmd_pos + 1;
}

esp_err_t runtime_helpers_publish_error_event(const network_config_t *network_config,
                                              resq_state_t state,
                                              const char *error_code,
                                              const char *message)
{
    char payload[512];

    int written = snprintf(payload,
                           sizeof(payload),
                           "{"
                           "\"event_id\":%d," 
                           "\"device_id\":\"%s\"," 
                           "\"state\":\"%s\"," 
                           "\"error_code\":\"%s\"," 
                           "\"message\":\"%s\"," 
                           "\"ts_ms\":%lld"
                           "}",
                           5000,
                           runtime_helpers_get_device_id(network_config),
                           resq_state_to_string(state),
                           error_code != NULL ? error_code : "UNKNOWN_ERROR",
                           message != NULL ? message : "",
                           (long long)runtime_helpers_now_ms());

    if (written <= 0 || written >= (int)sizeof(payload)) {
        return ESP_ERR_INVALID_SIZE;
    }

    ESP_LOGE(TAG,
             "State error state=%s code=%s message=%s",
             resq_state_to_string(state),
             error_code != NULL ? error_code : "UNKNOWN_ERROR",
             message != NULL ? message : "");

    if (!mqtt_manager_is_connected()) {
        return ESP_ERR_INVALID_STATE;
    }

    return mqtt_manager_publish_topic_json(RESQ_SUFFIX_EVENTS_ERROR, payload);
}

esp_err_t resq_command_extract_request_id(const char *payload, char *out, size_t out_len)
{
    if (payload == NULL || out == NULL || out_len == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    cJSON *root = cJSON_Parse(payload);
    if (root == NULL) {
        /* Treat unparsable payload as missing IDs */
        return ESP_ERR_NOT_FOUND;
    }

    esp_err_t result = ESP_ERR_NOT_FOUND;

    /* Prefer request_id (new contract) */
    cJSON *req = cJSON_GetObjectItemCaseSensitive(root, "request_id");
    if (req != NULL) {
        if (!cJSON_IsString(req) || req->valuestring == NULL) {
            cJSON_Delete(root);
            return ESP_ERR_NOT_FOUND;
        }
        if (req->valuestring[0] != '\0') {
            result = copy_request_id_if_fits(req->valuestring, out, out_len);
            cJSON_Delete(root);
            return result;
        }
    }

    /* Backward compatibility: accept command_id if request_id missing
     * TODO: remove command_id compatibility after LocalHub uses request_id */
    cJSON *cmd = cJSON_GetObjectItemCaseSensitive(root, "command_id");
    if (cJSON_IsString(cmd) && cmd->valuestring != NULL && cmd->valuestring[0] != '\0') {
        result = copy_request_id_if_fits(cmd->valuestring, out, out_len);
        cJSON_Delete(root);
        return result;
    }

    cJSON_Delete(root);
    return result;
}

esp_err_t runtime_helpers_publish_command_result_from_command(const network_config_t *network_config,
                                                              resq_state_t state,
                                                              const resq_mqtt_command_t *cmd,
                                                              const char *command_suffix,
                                                              const char *status,
                                                              const char *reason)
{
    if (network_config == NULL || cmd == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    (void)network_config;

    /* Extract request_id (must be present for command replies) */
    char request_id[128] = {0};
    esp_err_t id_err = resq_command_extract_request_id(cmd->payload, request_id, sizeof(request_id));
    if (id_err != ESP_OK) {
        request_id[0] = '\0';
    }

    /* Determine routing and event_id based on command suffix */
    int event_id = 1000; /* generic command ACK/NACK */
    const char *topic_suffix = RESQ_SUFFIX_EVENTS;

    if (command_suffix != NULL) {
        if (strncmp(command_suffix, "cmd/calibration", 15) == 0) {
            event_id = 4000;
            topic_suffix = RESQ_SUFFIX_EVENTS_CALIBRATION;
        } else if (strncmp(command_suffix, "cmd/system", 10) == 0) {
            event_id = 5001;
            topic_suffix = RESQ_SUFFIX_EVENTS_ERROR;
        } else if (strcmp(command_suffix, RESQ_SUFFIX_CMD_DEBUG) == 0 && status != NULL && strcmp(status, "ACK") == 0) {
            event_id = 1002;
            topic_suffix = RESQ_SUFFIX_EVENTS;
        } else {
            event_id = 1000;
            topic_suffix = RESQ_SUFFIX_EVENTS;
        }
    }

    char reason_segment[160] = {0};
    if (!runtime_helpers_is_blank(reason) && status != NULL && strcmp(status, "NACK") == 0) {
        const char *field_name = runtime_helpers_is_reason_id(reason) ? "reason_id" : "reason";
        int reason_written = snprintf(reason_segment,
                                      sizeof(reason_segment),
                                      ",\"%s\":\"%s\"",
                                      field_name,
                                      reason);
        if (reason_written <= 0 || reason_written >= (int)sizeof(reason_segment)) {
            return ESP_ERR_INVALID_SIZE;
        }
    }

    char payload[640];
    int written = snprintf(payload,
                           sizeof(payload),
                           "{"
                           "\"event_id\":%d," 
                           "\"reply_id\":\"%s\"," 
                           "\"status\":\"%s\"," 
                           "\"state\":\"%s\""
                           "%s"
                           ","
                           "\"ts_ms\":%lld"
                           "}",
                           event_id,
                           request_id,
                           status != NULL ? status : "",
                           resq_state_to_string(state),
                           reason_segment,
                           (long long)runtime_helpers_now_ms());

    if (written <= 0 || written >= (int)sizeof(payload)) {
        return ESP_ERR_INVALID_SIZE;
    }

    if (!mqtt_manager_is_connected()) {
        return ESP_ERR_INVALID_STATE;
    }

    return mqtt_manager_publish_topic_json(topic_suffix, payload);
}

esp_err_t runtime_helpers_publish_command_result(const network_config_t *network_config,
                                                 resq_state_t state,
                                                 const char *command,
                                                 const char *status,
                                                 const char *reason)
{
    char payload[512];

    int written = snprintf(payload,
                           sizeof(payload),
                           "{"
                           "\"device_id\":\"%s\"," 
                           "\"command\":\"%s\"," 
                           "\"status\":\"%s\"," 
                           "\"reason\":\"%s\"," 
                           "\"state\":\"%s\"," 
                           "\"ts_ms\":%lld"
                           "}",
                           runtime_helpers_get_device_id(network_config),
                           command != NULL ? command : "",
                           status != NULL ? status : "",
                           reason != NULL ? reason : "",
                           resq_state_to_string(state),
                           (long long)runtime_helpers_now_ms());

    if (written <= 0 || written >= (int)sizeof(payload)) {
        return ESP_ERR_INVALID_SIZE;
    }

    if (!mqtt_manager_is_connected()) {
        return ESP_ERR_INVALID_STATE;
    }

    return mqtt_manager_publish_event_json(payload);
}



esp_err_t runtime_helpers_publish_debug_snapshot(const network_config_t *network_config)
{
    if (network_config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    int32_t pressure_0_raw = 0;
    int32_t pressure_1_raw = 0;
    int32_t pressure_2_raw = 0;

    esp_err_t perr = hx710_read_3_shared_sck(
        BOARD_HX710_SHARED_SCK,
        BOARD_HX710_0_DOUT,
        BOARD_HX710_1_DOUT,
        BOARD_HX710_2_DOUT,
        &pressure_0_raw,
        &pressure_1_raw,
        &pressure_2_raw);

    if (perr != ESP_OK) {
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

    calibration_config_t calibration = {0};
    esp_err_t config_err = config_store_load_calibration(&calibration);

    sensor_raw_sample_t raw = {
        .pressure_0_raw = pressure_0_raw,
        .pressure_1_raw = pressure_1_raw,
        .pressure_2_raw = pressure_2_raw,
        .hall_raw = hall_raw,
        .ts_ms = esp_timer_get_time() / 1000,
        .quality_flags = 0,
    };
    sensor_converted_sample_t converted = {0};
    bool converted_ok = config_err == ESP_OK &&
                        sensor_conversion_convert_sample(&raw, &calibration, &converted) == ESP_OK;
    bool pressure_0_kpa_valid = converted_ok &&
                                calibration.pressure_valid &&
                                converted.pressure_0_kpa_valid;
    bool pressure_1_kpa_valid = converted_ok &&
                                calibration.pressure_valid &&
                                converted.pressure_1_kpa_valid;
    bool pressure_2_kpa_valid = converted_ok &&
                                calibration.pressure_valid &&
                                converted.pressure_2_kpa_valid;
    bool pressure_kpa_valid = pressure_0_kpa_valid &&
                              pressure_1_kpa_valid &&
                              pressure_2_kpa_valid;
    bool hall_mm_valid = converted_ok &&
                         calibration.hall_valid &&
                         converted.hall_mm_valid;

    char payload[960];

    int written = snprintf(payload,
                           sizeof(payload),
                           "{"
                           "\"device_id\":\"%s\"," 
                           "\"pressure_0_raw\":%ld," 
                           "\"pressure_1_raw\":%ld," 
                           "\"pressure_2_raw\":%ld," 
                           "\"hall_raw\":%d," 
                           "\"pressure_0_kpa\":%.3f,"
                           "\"pressure_0_kpa_valid\":%s,"
                           "\"pressure_1_kpa\":%.3f,"
                           "\"pressure_1_kpa_valid\":%s,"
                           "\"pressure_2_kpa\":%.3f,"
                           "\"pressure_2_kpa_valid\":%s,"
                           "\"hall_mm\":%.3f,"
                           "\"hall_progress\":%.3f,"
                           "\"pressure_kpa_valid\":%s,"
                           "\"hall_mm_valid\":%s,"
                           "\"pressure_saturation_mask\":%u,"
                           "\"ts_ms\":%lld"
                           "}",
                           runtime_helpers_get_device_id(network_config),
                           (long)pressure_0_raw,
                           (long)pressure_1_raw,
                           (long)pressure_2_raw,
                           hall_raw,
                           pressure_0_kpa_valid ? converted.pressure_0_kpa : 0.0f,
                           pressure_0_kpa_valid ? "true" : "false",
                           pressure_1_kpa_valid ? converted.pressure_1_kpa : 0.0f,
                           pressure_1_kpa_valid ? "true" : "false",
                           pressure_2_kpa_valid ? converted.pressure_2_kpa : 0.0f,
                           pressure_2_kpa_valid ? "true" : "false",
                           hall_mm_valid ? converted.hall_mm : 0.0f,
                           hall_mm_valid ? converted.hall_progress : 0.0f,
                           pressure_kpa_valid ? "true" : "false",
                           hall_mm_valid ? "true" : "false",
                           (unsigned int)(converted_ok ? converted.pressure_saturation_mask : 0),
                           (long long)raw.ts_ms);

    if (written <= 0 || written >= (int)sizeof(payload)) {
        return ESP_ERR_INVALID_SIZE;
    }

    return mqtt_manager_publish_debug_json(payload);
}
