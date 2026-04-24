#include "command_handler.h"

#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "esp_log.h"

#include "device_control.h"
#include "mqtt_manager.h"
#include "health_monitor.h"
#include "resq_protocol.h"
#include "sensor_runtime.h"
#include "session_manager.h"

static const char *TAG = "command_handler";

static device_config_t s_cfg;

static void publish_command_result(const char *command, const char *status, const char *reason)
{
    char *payload = resq_payload_command_result(
        s_cfg.device_id,
        session_manager_get_id(),
        command,
        status,
        reason
    );

    if (payload) {
        mqtt_manager_publish(RESQ_SUFFIX_EVENTS, payload, 1, 0);
        cJSON_free(payload);
    }
}

static esp_err_t handle_session_start(const char *payload)
{
    char session_id[64] = {0};

    if (session_manager_is_active()) {
        publish_command_result("session/start", "NACK", "session already active");
        return ESP_ERR_INVALID_STATE;
    }

    cJSON *root = cJSON_Parse(payload);
    if (root) {
        cJSON *sid = cJSON_GetObjectItemCaseSensitive(root, "session_id");
        if (cJSON_IsString(sid) && sid->valuestring) {
            snprintf(session_id, sizeof(session_id), "%s", sid->valuestring);
        }
        cJSON_Delete(root);
    }

    if (session_id[0] == '\0') {
        publish_command_result("session/start", "NACK", "missing session_id");
        return ESP_ERR_INVALID_ARG;
    }

    session_manager_start(session_id);
    sensor_runtime_reset_session_data();

    esp_err_t err = sensor_runtime_start();
    if (err != ESP_OK) {
        session_manager_stop();
        publish_command_result("session/start", "NACK", "failed to start sensor task");
        return err;
    }

    publish_command_result("session/start", "ACK", "");
    ESP_LOGI(TAG, "Session started: %s", session_id);
    return ESP_OK;
}

static esp_err_t handle_session_stop(const char *payload)
{
    (void)payload;

    if (!session_manager_is_active()) {
        publish_command_result("session/stop", "NACK", "no active session");
        return ESP_ERR_INVALID_STATE;
    }

    esp_err_t err = sensor_runtime_stop();
    if (err != ESP_OK) {
        publish_command_result("session/stop", "NACK", "failed to stop sensor task");
        return err;
    }

    session_manager_stop();
    publish_command_result("session/stop", "ACK", "");

    ESP_LOGI(TAG, "Session stopped");
    return ESP_OK;
}

static esp_err_t handle_diag_ping(const char *payload)
{
    (void)payload;

    publish_command_result("diag/ping", "ACK", "device alive");
    ESP_LOGI(TAG, "diag/ping handled");
    return ESP_OK;
}

static esp_err_t handle_diag_request(const char *payload)
{
    (void)payload;

    sensor_snapshot_t snap = {0};
    bool have_snap = (sensor_runtime_get_latest(&snap) == ESP_OK);

    cJSON *root = cJSON_CreateObject();
    if (!root) {
        return ESP_ERR_NO_MEM;
    }

    cJSON_AddStringToObject(root, "device_id", s_cfg.device_id);
    cJSON_AddStringToObject(root, "manikin_id", s_cfg.manikin_id);
    cJSON_AddBoolToObject(root, "session_active", session_manager_is_active());
    cJSON_AddStringToObject(root, "session_id", session_manager_get_id());
    cJSON_AddBoolToObject(root, "sensor_running", sensor_runtime_is_running());

    if (have_snap) {
        cJSON_AddBoolToObject(root, "force1_ok", snap.force1_ok);
        cJSON_AddBoolToObject(root, "force2_ok", snap.force2_ok);
        cJSON_AddBoolToObject(root, "hall_ok", snap.hall_ok);
        cJSON_AddNumberToObject(root, "hall_raw", snap.hall_raw);
        cJSON_AddNumberToObject(root, "current_delta", snap.current_delta);
        cJSON_AddNumberToObject(root, "compression_count", snap.total_compressions);
    }

    char *body = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);

    if (body) {
        mqtt_manager_publish(RESQ_SUFFIX_EVENTS, body, 1, 0);
        cJSON_free(body);
    }

    ESP_LOGI(TAG, "diag/request handled");
    return ESP_OK;
}

static esp_err_t handle_device_reset(const char *payload)
{
    (void)payload;
    publish_command_result("device/reset", "ACK", "reboot scheduled");
    return device_control_request_reboot();
}

static esp_err_t handle_device_unpair(const char *payload)
{
    (void)payload;
    publish_command_result("device/unpair", "ACK", "unpair scheduled");
    return device_control_request_unpair();
}

static esp_err_t handle_config_update(const char *payload)
{
    device_config_t new_cfg = s_cfg;

    cJSON *root = cJSON_Parse(payload);
    if (!root) {
        publish_command_result("config/update", "NACK", "invalid JSON");
        return ESP_ERR_INVALID_ARG;
    }

    cJSON *mqtt_host = cJSON_GetObjectItemCaseSensitive(root, "mqtt_host");
    cJSON *mqtt_port = cJSON_GetObjectItemCaseSensitive(root, "mqtt_port");
    cJSON *register_url = cJSON_GetObjectItemCaseSensitive(root, "register_url");

    cJSON *hall_baseline = cJSON_GetObjectItemCaseSensitive(root, "hall_baseline");
    cJSON *hall_min_delta = cJSON_GetObjectItemCaseSensitive(root, "hall_min_delta");
    cJSON *hall_max_delta = cJSON_GetObjectItemCaseSensitive(root, "hall_max_delta");
    cJSON *compression_start_delta = cJSON_GetObjectItemCaseSensitive(root, "compression_start_delta");
    cJSON *sensor_sample_interval_ms = cJSON_GetObjectItemCaseSensitive(root, "sensor_sample_interval_ms");

    if (cJSON_IsString(mqtt_host) && mqtt_host->valuestring && mqtt_host->valuestring[0] != '\0') {
        snprintf(new_cfg.mqtt_host, sizeof(new_cfg.mqtt_host), "%s", mqtt_host->valuestring);
    }

    if (cJSON_IsNumber(mqtt_port) && mqtt_port->valueint > 0) {
        new_cfg.mqtt_port = mqtt_port->valueint;
    }

    if (cJSON_IsString(register_url) && register_url->valuestring && register_url->valuestring[0] != '\0') {
        snprintf(new_cfg.register_url, sizeof(new_cfg.register_url), "%s", register_url->valuestring);
    }

    if (cJSON_IsNumber(hall_baseline)) {
        new_cfg.hall_baseline = hall_baseline->valueint;
    }

    if (cJSON_IsNumber(hall_min_delta)) {
        new_cfg.hall_min_delta = hall_min_delta->valueint;
    }

    if (cJSON_IsNumber(hall_max_delta)) {
        new_cfg.hall_max_delta = hall_max_delta->valueint;
    }

    if (cJSON_IsNumber(compression_start_delta)) {
        new_cfg.compression_start_delta = compression_start_delta->valueint;
    }

    if (cJSON_IsNumber(sensor_sample_interval_ms) && sensor_sample_interval_ms->valueint > 0) {
        new_cfg.sensor_sample_interval_ms = sensor_sample_interval_ms->valueint;
    }

    cJSON_Delete(root);

    /* 1. Validate the candidate config */
    esp_err_t err = device_control_validate_config_update(&new_cfg);
    if (err != ESP_OK) {
        publish_command_result("config/update", "NACK", "config validation failed");
        return err;
    }

    /* 2. Apply runtime changes first */
    err = sensor_runtime_apply_config(&new_cfg);
    if (err != ESP_OK) {
        publish_command_result("config/update", "NACK", "runtime apply failed");
        return err;
    }

    /* 3. Persist only after runtime apply succeeded */
    err = device_control_save_config_update(&new_cfg);
    if (err != ESP_OK) {
        publish_command_result("config/update", "NACK", "config save failed");
        return err;
    }

    s_cfg = new_cfg;

    publish_command_result("config/update", "ACK", "");
    ESP_LOGI(TAG, "config/update handled");

    return ESP_OK;
}

esp_err_t command_handler_init(const device_config_t *cfg)
{
    if (cfg == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    s_cfg = *cfg;
    return ESP_OK;
}

esp_err_t command_handler_handle_message(const char *suffix, const char *payload)
{
    if (suffix == NULL || payload == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (strcmp(suffix, RESQ_SUFFIX_CMD_SESSION_START) == 0) {
        return handle_session_start(payload);
    }

    if (strcmp(suffix, RESQ_SUFFIX_CMD_SESSION_STOP) == 0) {
        return handle_session_stop(payload);
    }

    if (strcmp(suffix, "cmd/diag/ping") == 0) {
        return handle_diag_ping(payload);
    }

    if (strcmp(suffix, "cmd/diag/request") == 0) {
        return handle_diag_request(payload);
    }

    if (strcmp(suffix, "cmd/device/reset") == 0) {
        return handle_device_reset(payload);
    }

    if (strcmp(suffix, "cmd/device/unpair") == 0) {
        return handle_device_unpair(payload);
    }

    if (strcmp(suffix, "cmd/config/update") == 0) {
        return handle_config_update(payload);
    }

    ESP_LOGW(TAG, "Unhandled command suffix: %s", suffix);
    return ESP_ERR_NOT_SUPPORTED;
}