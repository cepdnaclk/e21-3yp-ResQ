#include "runtime_helpers.h"

#include <stdio.h>
#include <string.h>

#include "esp_log.h"
#include "esp_timer.h"
#include "esp_app_desc.h"

#include "cJSON.h"

#include "mqtt_manager.h"
#include "config_store.h"
#include "board_config.h"
#include "hx710.h"
#include "hall_sensor.h"
#include "ota_update_manager.h"
#include "session_manager.h"
#include "wifi_manager.h"

static const char *TAG = "runtime_helpers";

static resq_state_t s_current_state = RESQ_STATE_BOOT;
static resq_state_t s_previous_state = RESQ_STATE_BOOT;
static int64_t s_state_entered_at_ms = 0;

static int64_t runtime_helpers_now_ms(void)
{
    return esp_timer_get_time() / 1000;
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
    if (cJSON_IsString(req) && req->valuestring != NULL && req->valuestring[0] != '\0') {
        strncpy(out, req->valuestring, out_len - 1);
        out[out_len - 1] = '\0';
        result = ESP_OK;
        cJSON_Delete(root);
        return result;
    }

    /* Backward compatibility: accept command_id if request_id missing
     * TODO: remove command_id compatibility after LocalHub uses request_id */
    cJSON *cmd = cJSON_GetObjectItemCaseSensitive(root, "command_id");
    if (cJSON_IsString(cmd) && cmd->valuestring != NULL && cmd->valuestring[0] != '\0') {
        strncpy(out, cmd->valuestring, out_len - 1);
        out[out_len - 1] = '\0';
        result = ESP_OK;
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
    (void)reason;

    /* Extract request_id (must be present for command replies) */
    char request_id[128] = {0};
    esp_err_t id_err = resq_command_extract_request_id(cmd->payload, request_id, sizeof(request_id));
    if (id_err != ESP_OK) {
        return ESP_ERR_INVALID_ARG;
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

    char payload[512];
    int written = snprintf(payload,
                           sizeof(payload),
                           "{"
                           "\"event_id\":%d," 
                           "\"reply_id\":\"%s\"," 
                           "\"status\":\"%s\"," 
                           "\"state\":\"%s\"," 
                           "\"ts_ms\":%lld"
                           "}",
                           event_id,
                           request_id,
                           status != NULL ? status : "",
                           resq_state_to_string(state),
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
                           (long long)(esp_timer_get_time() / 1000));

    if (written <= 0 || written >= (int)sizeof(payload)) {
        return ESP_ERR_INVALID_SIZE;
    }

    return mqtt_manager_publish_debug_json(payload);
}

void runtime_helpers_record_state(resq_state_t state)
{
    if (state == s_current_state && s_state_entered_at_ms != 0) {
        return;
    }

    s_previous_state = s_current_state;
    s_current_state = state;
    s_state_entered_at_ms = runtime_helpers_now_ms();
}

resq_state_t runtime_helpers_get_current_state(void)
{
    return s_current_state;
}

resq_state_t runtime_helpers_get_previous_state(void)
{
    return s_previous_state;
}

int64_t runtime_helpers_get_state_entered_at_ms(void)
{
    return s_state_entered_at_ms;
}

static const char *runtime_helpers_active_operation(resq_state_t state)
{
    switch (state) {
    case RESQ_STATE_PROVISIONING:
        return "WAITING_FOR_CONFIGURATION";
    case RESQ_STATE_OTA_UPDATE:
        return "FIRMWARE_UPDATE";
    case RESQ_STATE_CALIBRATING:
        return "CALIBRATION";
    case RESQ_STATE_SESSION_ACTIVE:
        return "CPR_SESSION";
    case RESQ_STATE_PAIRED_IDLE:
    case RESQ_STATE_READY_FOR_SESSION:
        return "WAITING_FOR_COMMAND";
    default:
        return "STATE_TRANSITION";
    }
}

esp_err_t runtime_helpers_publish_state_snapshot(
    const network_config_t *network_config,
    const calibration_config_t *calibration_config,
    const char *reply_id)
{
    if (network_config == NULL || calibration_config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    int64_t now_ms = runtime_helpers_now_ms();
    char ip[16] = {0};
    if (wifi_manager_is_connected()) {
        wifi_manager_get_ip(ip, sizeof(ip));
    }

    session_state_t session = {0};
    session_manager_get_state(&session);

    ota_metadata_t ota_metadata;
    memset(&ota_metadata, 0, sizeof(ota_metadata));
    config_store_load_ota_metadata(&ota_metadata);

    ota_update_status_t ota_status;
    memset(&ota_status, 0, sizeof(ota_status));
    ota_update_manager_get_status(&ota_status);

    const esp_app_desc_t *app_description = esp_app_get_description();
    const char *mqtt_device_id = mqtt_manager_get_device_id();
    bool backend_registered =
        mqtt_device_id != NULL && mqtt_device_id[0] != '\0';

    cJSON *root = cJSON_CreateObject();
    if (root == NULL) {
        return ESP_ERR_NO_MEM;
    }

    cJSON_AddStringToObject(root, "debug_type", "STATE_SNAPSHOT");
    cJSON_AddStringToObject(root,
                           "reply_id",
                           reply_id != NULL ? reply_id : "");
    cJSON_AddStringToObject(root, "device_id", runtime_helpers_get_device_id(network_config));
    cJSON_AddStringToObject(root,
                           "firmware_version",
                           app_description != NULL ? app_description->version : "");

    cJSON *state = cJSON_AddObjectToObject(root, "state");
    cJSON_AddStringToObject(state,
                           "current",
                           resq_state_to_string(s_current_state));
    cJSON_AddStringToObject(state,
                           "previous",
                           resq_state_to_string(s_previous_state));
    cJSON_AddNumberToObject(state,
                           "entered_at_ms",
                           s_state_entered_at_ms);
    cJSON_AddNumberToObject(state,
                           "age_ms",
                           s_state_entered_at_ms > 0
                               ? now_ms - s_state_entered_at_ms
                               : 0);
    cJSON_AddStringToObject(state,
                           "active_operation",
                           runtime_helpers_active_operation(s_current_state));

    cJSON *network = cJSON_AddObjectToObject(root, "network");
    cJSON_AddBoolToObject(network,
                         "wifi_connected",
                         wifi_manager_is_connected());
    cJSON_AddBoolToObject(network,
                         "backend_registered",
                         backend_registered);
    cJSON_AddBoolToObject(network,
                         "mqtt_connected",
                         mqtt_manager_is_connected());
    cJSON_AddStringToObject(network, "ip", ip);

    cJSON *calibration = cJSON_AddObjectToObject(root, "calibration");
    cJSON_AddBoolToObject(calibration,
                         "calibrated",
                         calibration_config->calibrated);
    cJSON_AddBoolToObject(calibration,
                         "ready_for_session",
                         calibration_config->calibrated);
    cJSON_AddStringToObject(calibration,
                           "last_result",
                           calibration_config->calibrated ? "PASS" : "NONE");
    cJSON_AddNumberToObject(calibration, "last_reason_id", 0);

    cJSON *session_json = cJSON_AddObjectToObject(root, "session");
    cJSON_AddBoolToObject(session_json,
                         "session_active",
                         session.active);
    cJSON_AddStringToObject(session_json,
                           "session_id",
                           session.active ? session.session_id : "");
    cJSON_AddBoolToObject(session_json,
                         "sensor_running",
                         session.active);
    cJSON_AddBoolToObject(session_json,
                         "telemetry_running",
                         session.active);

    cJSON *ota = cJSON_AddObjectToObject(root, "ota");
    cJSON_AddStringToObject(ota,
                           "phase",
                           ota_update_manager_phase_to_string(ota_status.phase));
    cJSON_AddStringToObject(ota,
                           "last_ota_result",
                           ota_metadata.last_result);
    cJSON_AddStringToObject(ota,
                           "last_ota_version",
                           ota_metadata.last_version);
    cJSON_AddNumberToObject(ota,
                           "last_ota_error_id",
                           ota_metadata.last_error_id);
    cJSON_AddNumberToObject(ota,
                           "last_ota_bytes_written",
                           ota_metadata.last_bytes_written);
    if (ota_metadata.last_failed_phase[0] != '\0') {
        cJSON_AddStringToObject(ota,
                               "last_ota_failed_phase",
                               ota_metadata.last_failed_phase);
    }

    cJSON_AddNumberToObject(root, "ts_ms", now_ms);

    char *out = cJSON_PrintUnformatted(root);
    if (out == NULL) {
        cJSON_Delete(root);
        return ESP_ERR_NO_MEM;
    }

    esp_err_t err = mqtt_manager_publish_debug_json(out);
    cJSON_free(out);
    cJSON_Delete(root);
    return err;
}
