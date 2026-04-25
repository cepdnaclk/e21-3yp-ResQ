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

static const char *get_string_field(cJSON *root, const char *primary_name, const char *alternate_name)
{
    cJSON *item = cJSON_GetObjectItemCaseSensitive(root, primary_name);
    if (cJSON_IsString(item) && item->valuestring != NULL && item->valuestring[0] != '\0') {
        return item->valuestring;
    }

    if (alternate_name != NULL) {
        item = cJSON_GetObjectItemCaseSensitive(root, alternate_name);
        if (cJSON_IsString(item) && item->valuestring != NULL && item->valuestring[0] != '\0') {
            return item->valuestring;
        }
    }

    return NULL;
}

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

static esp_err_t publish_session_transition_event(
    const char *event_type,
    const char *reason,
    const char *session_id,
    const char *trainee_id,
    const char *started_at,
    const char *scenario,
    bool session_active
)
{
    cJSON *root = cJSON_CreateObject();
    if (root == NULL) {
        return ESP_ERR_NO_MEM;
    }

    cJSON_AddStringToObject(root, "device_id", s_cfg.device_id);
    cJSON_AddStringToObject(root, "session_id", session_id);
    cJSON_AddStringToObject(root, "event_type", event_type);
    cJSON_AddBoolToObject(root, "session_active", session_active);
    cJSON_AddStringToObject(root, "trainee_id", trainee_id);
    cJSON_AddStringToObject(root, "started_at", started_at);
    cJSON_AddStringToObject(root, "scenario", scenario);
    cJSON_AddStringToObject(root, "reason", reason);

    char *payload = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);

    if (payload == NULL) {
        return ESP_ERR_NO_MEM;
    }

    mqtt_manager_publish(RESQ_SUFFIX_EVENTS, payload, 1, 0);
    cJSON_free(payload);
    return ESP_OK;
}

static esp_err_t handle_session_start(const char *payload)
{
    char session_id[64] = {0};
    char trainee_id[64] = {0};
    char started_at[64] = {0};
    char scenario[64] = {0};
    char device_id[64] = {0};
    bool have_device_id = false;

    if (session_manager_is_active()) {
        publish_command_result("session/start", "NACK", "session already active");
        return ESP_ERR_INVALID_STATE;
    }

    cJSON *root = cJSON_Parse(payload);
    if (root) {
        const char *value = get_string_field(root, "sessionId", "session_id");
        if (value != NULL) {
            snprintf(session_id, sizeof(session_id), "%s", value);
        }

        value = get_string_field(root, "deviceId", "device_id");
        if (value != NULL) {
            snprintf(device_id, sizeof(device_id), "%s", value);
            have_device_id = true;
        }

        value = get_string_field(root, "traineeId", "trainee_id");
        if (value != NULL) {
            snprintf(trainee_id, sizeof(trainee_id), "%s", value);
        }

        value = get_string_field(root, "startedAt", "started_at");
        if (value != NULL) {
            snprintf(started_at, sizeof(started_at), "%s", value);
        }

        value = get_string_field(root, "scenario", NULL);
        if (value != NULL) {
            snprintf(scenario, sizeof(scenario), "%s", value);
        }

        cJSON_Delete(root);
    }

    if (session_id[0] == '\0') {
        publish_command_result("session/start", "NACK", "missing sessionId");
        return ESP_ERR_INVALID_ARG;
    }

    if (have_device_id && strcmp(device_id, s_cfg.device_id) != 0) {
        publish_command_result("session/start", "NACK", "deviceId mismatch");
        return ESP_ERR_INVALID_ARG;
    }

    session_manager_start(session_id, trainee_id, started_at, scenario);
    sensor_runtime_reset_session_data();

    esp_err_t err = sensor_runtime_start();
    if (err != ESP_OK) {
        session_manager_stop();
        publish_command_result("session/start", "NACK", "failed to start sensor task");
        return err;
    }

    mqtt_manager_publish_status("SESSION_ACTIVE");
    health_monitor_publish_heartbeat();
    publish_session_transition_event(
        "session_started",
        "",
        session_manager_get_id(),
        session_manager_get_trainee_id(),
        session_manager_get_started_at(),
        session_manager_get_scenario(),
        true
    );
    publish_command_result("session/start", "ACK", "");
    ESP_LOGI(
        TAG,
        "Session started: sessionId=%s traineeId=%s scenario=%s startedAt=%s",
        session_id,
        trainee_id[0] != '\0' ? trainee_id : "",
        scenario[0] != '\0' ? scenario : "",
        started_at[0] != '\0' ? started_at : ""
    );
    return ESP_OK;
}

static esp_err_t handle_session_stop(const char *payload)
{
    char session_id[64] = {0};
    char device_id[64] = {0};
    char ended_at[64] = {0};
    bool have_session_id = false;
    bool have_device_id = false;

    cJSON *root = cJSON_Parse(payload);
    if (root) {
        const char *value = get_string_field(root, "sessionId", "session_id");
        if (value != NULL) {
            snprintf(session_id, sizeof(session_id), "%s", value);
            have_session_id = true;
        }

        value = get_string_field(root, "deviceId", "device_id");
        if (value != NULL) {
            snprintf(device_id, sizeof(device_id), "%s", value);
            have_device_id = true;
        }

        value = get_string_field(root, "endedAt", "ended_at");
        if (value != NULL) {
            snprintf(ended_at, sizeof(ended_at), "%s", value);
        }

        cJSON_Delete(root);
    }

    if (!session_manager_is_active()) {
        publish_command_result("session/stop", "NACK", "no active session");
        return ESP_ERR_INVALID_STATE;
    }

    if (have_device_id && strcmp(device_id, s_cfg.device_id) != 0) {
        publish_command_result("session/stop", "NACK", "deviceId mismatch");
        return ESP_ERR_INVALID_ARG;
    }

    if (have_session_id && strcmp(session_id, session_manager_get_id()) != 0) {
        publish_command_result("session/stop", "NACK", "sessionId mismatch");
        return ESP_ERR_INVALID_ARG;
    }

    esp_err_t err = sensor_runtime_stop();
    if (err != ESP_OK) {
        publish_command_result("session/stop", "NACK", "failed to stop sensor task");
        return err;
    }

    char current_session_id[64] = {0};
    char current_trainee_id[64] = {0};
    char current_started_at[64] = {0};
    char current_scenario[64] = {0};

    snprintf(current_session_id, sizeof(current_session_id), "%s", session_manager_get_id());
    snprintf(current_trainee_id, sizeof(current_trainee_id), "%s", session_manager_get_trainee_id());
    snprintf(current_started_at, sizeof(current_started_at), "%s", session_manager_get_started_at());
    snprintf(current_scenario, sizeof(current_scenario), "%s", session_manager_get_scenario());

    publish_command_result("session/stop", "ACK", "");
    session_manager_stop();
    mqtt_manager_publish_status("IDLE");
    health_monitor_publish_heartbeat();
    publish_session_transition_event(
        "session_stopped",
        ended_at[0] != '\0' ? ended_at : "",
        current_session_id,
        current_trainee_id,
        current_started_at,
        current_scenario,
        false
    );

    ESP_LOGI(
        TAG,
        "Session stopped: sessionId=%s endedAt=%s",
        have_session_id ? session_id : "",
        ended_at[0] != '\0' ? ended_at : ""
    );
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