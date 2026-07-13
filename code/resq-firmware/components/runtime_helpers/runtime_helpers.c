#include "runtime_helpers.h"
#include "runtime_identity.h"

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
#include "sensor_owner.h"
#include "esp_timer.h"

static const char *TAG = "runtime_helpers";
#define COMMAND_RESPONSE_CACHE_PAYLOAD_MAX_LEN 640

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

static uint32_t runtime_helpers_pressure_saturation_mask(int32_t p0,
                                                         int32_t p1,
                                                         int32_t p2)
{
    uint32_t mask = 0u;
    if (sensor_conversion_pressure_raw_is_saturated(p0)) mask |= 0x01u;
    if (sensor_conversion_pressure_raw_is_saturated(p1)) mask |= 0x02u;
    if (sensor_conversion_pressure_raw_is_saturated(p2)) mask |= 0x04u;
    return mask;
}

static sensor_conversion_profile_t runtime_helpers_conversion_profile(
    const calibration_config_t *calibration)
{
    sensor_conversion_profile_t profile = {
        .pressure_baseline_raw = {
            calibration->pressure_0_baseline,
            calibration->pressure_1_baseline,
            calibration->pressure_2_baseline,
        },
        .pressure_baseline_valid = {
            calibration->pressure_0_baseline != 0,
            calibration->pressure_1_baseline != 0,
            calibration->pressure_2_baseline != 0,
        },
        .pressure_kpa_per_count = {
            calibration->pressure_0_kpa_per_count,
            calibration->pressure_1_kpa_per_count,
            calibration->pressure_2_kpa_per_count,
        },
        .hall_baseline_raw = calibration->hall_baseline,
        .hall_baseline_valid = calibration->hall_baseline > 0,
        .hall_range_raw = calibration->hall_range_raw,
        .hall_direction = (int8_t)calibration->hall_direction,
        .full_depth_mm = calibration->full_depth_mm,
        .required_pressure_mask = SENSOR_CONVERSION_PRESSURE_DEFAULT_REQUIRED_MASK,
    };
    return profile;
}

static esp_err_t copy_request_id_if_fits(const char *value, char *out, size_t out_len)
{
    size_t len = strlen(value);
    if (len == 0 || len >= out_len) {
        return ESP_ERR_INVALID_SIZE;
    }

    for (size_t i = 0; i < len; ++i) {
        char ch = value[i];
        bool allowed = (ch >= 'a' && ch <= 'z') ||
                       (ch >= 'A' && ch <= 'Z') ||
                       (ch >= '0' && ch <= '9') || ch == '-' || ch == '_' ||
                       ch == '.' || ch == ':';
        if (!allowed) return ESP_ERR_INVALID_ARG;
    }

    memcpy(out, value, len + 1);
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
    if (network_config == NULL) return ESP_ERR_INVALID_ARG;

    ESP_LOGE(TAG,
             "State error state=%s code=%s message=%s",
             resq_state_to_string(state),
             error_code != NULL ? error_code : "UNKNOWN_ERROR",
             message != NULL ? message : "");

    if (!mqtt_manager_is_connected()) {
        return ESP_ERR_INVALID_STATE;
    }

    cJSON *root = cJSON_CreateObject();
    if (root == NULL) return ESP_ERR_NO_MEM;
    cJSON_AddNumberToObject(root, "event_id", 5000);
    cJSON_AddStringToObject(root, "device_id",
                           runtime_helpers_get_device_id(network_config));
    cJSON_AddStringToObject(root, "state", resq_state_to_string(state));
    cJSON_AddStringToObject(root, "error_code",
                           error_code != NULL ? error_code : "UNKNOWN_ERROR");
    cJSON_AddStringToObject(root, "message", message != NULL ? message : "");
    cJSON_AddNumberToObject(root, "ts_ms", runtime_helpers_now_ms());
    char *payload = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (payload == NULL) return ESP_ERR_NO_MEM;
    esp_err_t publish_err =
        mqtt_manager_publish_topic_json(RESQ_SUFFIX_EVENTS_ERROR, payload);
    cJSON_free(payload);
    return publish_err;
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

    cJSON *root = cJSON_CreateObject();
    if (root == NULL) return ESP_ERR_NO_MEM;
    cJSON_AddNumberToObject(root, "event_id", event_id);
    cJSON_AddStringToObject(root, "reply_id", request_id);
    cJSON_AddStringToObject(root, "status", status != NULL ? status : "");
    cJSON_AddStringToObject(root, "state", resq_state_to_string(state));
    if (!runtime_helpers_is_blank(reason) && status != NULL &&
        strcmp(status, "NACK") == 0) {
        const char *field_name = runtime_helpers_is_reason_id(reason)
                                     ? "reason_id"
                                     : "reason";
        cJSON_AddStringToObject(root, field_name, reason);
    }
    cJSON_AddNumberToObject(root, "ts_ms", runtime_helpers_now_ms());

    char *payload = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (payload == NULL) return ESP_ERR_NO_MEM;
    if (strlen(payload) >= COMMAND_RESPONSE_CACHE_PAYLOAD_MAX_LEN) {
        cJSON_free(payload);
        return ESP_ERR_INVALID_SIZE;
    }

    char *ordered_payload = NULL;
    esp_err_t identity_err =
        runtime_identity_ensure_json_payload(payload, &ordered_payload);
    if (identity_err == ESP_OK && ordered_payload != NULL) {
        cJSON_free(payload);
        payload = ordered_payload;
    } else if (identity_err != ESP_OK) {
        cJSON_free(payload);
        return identity_err;
    }

    if (request_id[0] != '\0') {
        (void)mqtt_manager_cache_command_response(cmd->topic, request_id,
                                                  topic_suffix, payload);
    }

    if (!mqtt_manager_is_connected()) {
        cJSON_free(payload);
        return ESP_ERR_INVALID_STATE;
    }

    esp_err_t publish_err = mqtt_manager_publish_topic_json(topic_suffix, payload);
    cJSON_free(payload);
    return publish_err;
}

esp_err_t runtime_helpers_publish_command_result(const network_config_t *network_config,
                                                 resq_state_t state,
                                                 const char *command,
                                                 const char *status,
                                                 const char *reason)
{
    if (network_config == NULL) return ESP_ERR_INVALID_ARG;
    cJSON *root = cJSON_CreateObject();
    if (root == NULL) return ESP_ERR_NO_MEM;
    cJSON_AddStringToObject(root, "device_id",
                           runtime_helpers_get_device_id(network_config));
    cJSON_AddStringToObject(root, "command", command != NULL ? command : "");
    cJSON_AddStringToObject(root, "status", status != NULL ? status : "");
    cJSON_AddStringToObject(root, "reason", reason != NULL ? reason : "");
    cJSON_AddStringToObject(root, "state", resq_state_to_string(state));
    cJSON_AddNumberToObject(root, "ts_ms", runtime_helpers_now_ms());
    char *payload = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (payload == NULL) return ESP_ERR_NO_MEM;

    if (!mqtt_manager_is_connected()) {
        cJSON_free(payload);
        return ESP_ERR_INVALID_STATE;
    }

    esp_err_t publish_err = mqtt_manager_publish_event_json(payload);
    cJSON_free(payload);
    return publish_err;
}



esp_err_t runtime_helpers_build_direct_debug_payload(const network_config_t *network_config,
                                                     const sensor_raw_sample_t *raw,
                                                     const sensor_converted_sample_t *converted,
                                                     bool converted_ok,
                                                     bool pressure_enabled,
                                                     bool hall_enabled,
                                                     char *out_payload,
                                                     size_t out_payload_len)
{
    if (network_config == NULL || raw == NULL || converted == NULL ||
        out_payload == NULL || out_payload_len == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    bool pressure_0_kpa_valid = converted_ok &&
                                pressure_enabled &&
                                converted->pressure_kpa_channel_valid[0];
    bool pressure_1_kpa_valid = converted_ok &&
                                pressure_enabled &&
                                converted->pressure_kpa_channel_valid[1];
    bool pressure_2_kpa_valid = converted_ok &&
                                pressure_enabled &&
                                converted->pressure_kpa_channel_valid[2];
    bool pressure_kpa_valid = pressure_0_kpa_valid &&
                              pressure_1_kpa_valid &&
                              pressure_2_kpa_valid;
    bool hall_mm_valid = converted_ok &&
                         hall_enabled &&
                         converted->hall_mm_valid;

    int written = snprintf(out_payload,
                           out_payload_len,
                           "{"
                           "\"device_id\":\"%s\","
                           "\"source\":\"DIRECT_SENSOR_SNAPSHOT\","
                           "\"pressure_0_raw\":%ld,"
                           "\"pressure_1_raw\":%ld,"
                           "\"pressure_2_raw\":%ld,"
                           "\"hall_raw\":%ld,"
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
                           (long)raw->pressure_raw[0],
                           (long)raw->pressure_raw[1],
                           (long)raw->pressure_raw[2],
                           (long)raw->hall_raw,
                           pressure_0_kpa_valid ? converted->pressure_kpa[0] : 0.0f,
                           pressure_0_kpa_valid ? "true" : "false",
                           pressure_1_kpa_valid ? converted->pressure_kpa[1] : 0.0f,
                           pressure_1_kpa_valid ? "true" : "false",
                           pressure_2_kpa_valid ? converted->pressure_kpa[2] : 0.0f,
                           pressure_2_kpa_valid ? "true" : "false",
                           hall_mm_valid ? converted->hall_mm : 0.0f,
                           hall_mm_valid ? converted->hall_progress : 0.0f,
                           pressure_kpa_valid ? "true" : "false",
                           hall_mm_valid ? "true" : "false",
                           (unsigned int)(converted_ok ? converted->pressure_saturation_mask : 0),
                           (long long)raw->timestamp_ms);

    if (written <= 0 || written >= (int)out_payload_len) {
        return ESP_ERR_INVALID_SIZE;
    }

    return ESP_OK;
}

esp_err_t runtime_helpers_publish_debug_snapshot(const network_config_t *network_config)
{
    if (network_config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    sensor_owner_t owner;
    esp_err_t owner_err = sensor_owner_get(&owner);
    if (owner_err != ESP_OK) {
        return owner_err;
    }
    if (owner != SENSOR_OWNER_NONE) {
        return ESP_ERR_INVALID_STATE;
    }

    int32_t pressure_0_raw = 0;
    int32_t pressure_1_raw = 0;
    int32_t pressure_2_raw = 0;

    uint8_t pressure_valid_mask = 0;
    esp_err_t perr = hx710_read_3_shared_sck_valid(
        BOARD_HX710_SHARED_SCK,
        BOARD_HX710_0_DOUT,
        BOARD_HX710_1_DOUT,
        BOARD_HX710_2_DOUT,
        &pressure_0_raw,
        &pressure_1_raw,
        &pressure_2_raw,
        &pressure_valid_mask);

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
        .pressure_raw = {
            pressure_0_raw,
            pressure_1_raw,
            pressure_2_raw,
        },
        .pressure_read_valid = {
            (pressure_valid_mask & HX710_VALID_CHANNEL_0) != 0,
            (pressure_valid_mask & HX710_VALID_CHANNEL_1) != 0,
            (pressure_valid_mask & HX710_VALID_CHANNEL_2) != 0,
        },
        .hall_raw = hall_raw,
        .hall_read_valid = true,
        .pressure_saturation_mask = runtime_helpers_pressure_saturation_mask(
            pressure_0_raw,
            pressure_1_raw,
            pressure_2_raw),
        .timestamp_ms = esp_timer_get_time() / 1000,
    };
    sensor_conversion_profile_t profile = runtime_helpers_conversion_profile(&calibration);
    sensor_converted_sample_t converted = {0};
    bool converted_ok = config_err == ESP_OK &&
                        sensor_conversion_convert(&raw, &profile, &converted) == ESP_OK;
    char payload[960];
    esp_err_t payload_err = runtime_helpers_build_direct_debug_payload(
        network_config,
        &raw,
        &converted,
        converted_ok,
        calibration.pressure_valid,
        calibration.hall_valid,
        payload,
        sizeof(payload));
    if (payload_err != ESP_OK) {
        return payload_err;
    }

    return mqtt_manager_publish_debug_json(payload);
}
