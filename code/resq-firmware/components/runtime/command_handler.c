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

static void publish_simple_event(const char *event_type, const char *message)
{
    cJSON *root = cJSON_CreateObject();
    if (!root) {
        return;
    }

    cJSON_AddStringToObject(root, "device_id", s_cfg.device_id);
    cJSON_AddStringToObject(root, "session_id", session_manager_get_id());
    cJSON_AddStringToObject(root, "event_type", event_type);
    cJSON_AddStringToObject(root, "message", message);

    char *payload = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);

    if (payload) {
        mqtt_manager_publish(RESQ_SUFFIX_EVENTS, payload, 1, 0);
        cJSON_free(payload);
    }
}

static esp_err_t handle_session_start(const char *payload)
{
    char session_id[64] = {0};

    cJSON *root = cJSON_Parse(payload);
    if (root) {
        cJSON *sid = cJSON_GetObjectItemCaseSensitive(root, "session_id");
        if (cJSON_IsString(sid) && sid->valuestring) {
            snprintf(session_id, sizeof(session_id), "%s", sid->valuestring);
        }
        cJSON_Delete(root);
    }

    if (session_id[0] == '\0') {
        snprintf(session_id, sizeof(session_id), "unknown");
    }

    session_manager_start(session_id);
    sensor_runtime_reset_session_data();
    ESP_ERROR_CHECK(sensor_runtime_start());

    ESP_LOGI(TAG, "Session started: %s", session_id);
    return ESP_OK;
}

static esp_err_t handle_session_stop(const char *payload)
{
    (void)payload;

    ESP_ERROR_CHECK(sensor_runtime_stop());
    session_manager_stop();

    ESP_LOGI(TAG, "Session stopped");
    return ESP_OK;
}

static esp_err_t handle_diag_ping(const char *payload)
{
    (void)payload;

    cJSON *root = cJSON_CreateObject();
    if (!root) {
        return ESP_ERR_NO_MEM;
    }

    cJSON_AddStringToObject(root, "device_id", s_cfg.device_id);
    cJSON_AddStringToObject(root, "event_type", "diag_ping_ack");
    cJSON_AddBoolToObject(root, "session_active", session_manager_is_active());
    cJSON_AddBoolToObject(root, "sensor_running", sensor_runtime_is_running());

    char *body = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);

    if (body) {
        mqtt_manager_publish(RESQ_SUFFIX_EVENTS, body, 1, 0);
        cJSON_free(body);
    }

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
    publish_simple_event("device_reset", "Reboot requested by Local Hub");
    return device_control_request_reboot();
}

static esp_err_t handle_device_unpair(const char *payload)
{
    (void)payload;
    publish_simple_event("device_unpair", "Unpair requested by Local Hub");
    return device_control_request_unpair();
}

static esp_err_t handle_config_update(const char *payload)
{
    device_config_t new_cfg = s_cfg;

    cJSON *root = cJSON_Parse(payload);
    if (!root) {
        return ESP_ERR_INVALID_ARG;
    }

    cJSON *mqtt_host = cJSON_GetObjectItemCaseSensitive(root, "mqtt_host");
    cJSON *mqtt_port = cJSON_GetObjectItemCaseSensitive(root, "mqtt_port");
    cJSON *register_url = cJSON_GetObjectItemCaseSensitive(root, "register_url");

    if (cJSON_IsString(mqtt_host) && mqtt_host->valuestring && mqtt_host->valuestring[0] != '\0') {
        snprintf(new_cfg.mqtt_host, sizeof(new_cfg.mqtt_host), "%s", mqtt_host->valuestring);
    }

    if (cJSON_IsNumber(mqtt_port) && mqtt_port->valueint > 0) {
        new_cfg.mqtt_port = mqtt_port->valueint;
    }

    if (cJSON_IsString(register_url) && register_url->valuestring && register_url->valuestring[0] != '\0') {
        snprintf(new_cfg.register_url, sizeof(new_cfg.register_url), "%s", register_url->valuestring);
    }

    cJSON_Delete(root);

    esp_err_t err = device_control_apply_config_update(&new_cfg);
    if (err != ESP_OK) {
        publish_simple_event("config_update_rejected", "Configuration update rejected");
        return err;
    }

    s_cfg = new_cfg;
    publish_simple_event("config_update", "Configuration updated and saved");
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