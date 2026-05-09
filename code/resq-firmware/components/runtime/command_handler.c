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
#include "calibration_manager.h"
#include "status_indicator.h"
#include "queued_publisher.h"
#include "command_handler.h"


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

static void publish_device_state(const char *state)
{
    if (state == NULL) {
        return;
    }

    cJSON *root = cJSON_CreateObject();
    if (root == NULL) {
        return;
    }

    cJSON_AddStringToObject(root, "device_id", s_cfg.device_id);
    cJSON_AddStringToObject(root, "manikin_id", s_cfg.manikin_id);
    cJSON_AddStringToObject(root, "state", state);
    cJSON_AddBoolToObject(root, "session_active", session_manager_is_active());
    cJSON_AddStringToObject(root, "session_id", session_manager_get_id());

    char *payload = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);

    if (payload == NULL) {
        return;
    }

    mqtt_manager_publish(RESQ_SUFFIX_STATUS, payload, 1, 1);

    cJSON_free(payload);
}

static void publish_calibration_report_event(void)
{
    char payload[512];

    const calibration_report_t *report = calibration_manager_get_report();

    if (report == NULL) {
        return;
    }

    esp_err_t err = resq_payload_calibration_report(
        s_cfg.device_id,
        report->profile_id,
        calibration_manager_result_to_string(report->result),
        report->ready_for_session,
        payload,
        sizeof(payload)
    );

    if (err != ESP_OK) {
        publish_command_result(
            "calibration/report",
            "NACK",
            "failed to build calibration report"
        );
        return;
    }

    /*
     * Calibration report is an important one-time event.
     * So publish it to RESQ_SUFFIX_EVENTS, not telemetry.
     */
    queued_publisher_publish_or_queue(
        RESQ_SUFFIX_EVENTS,
        payload,
        1,
        0
    );
}

static esp_err_t handle_session_start(const char *payload)
{
    char session_id[64] = {0};

    if (session_manager_is_active()) {
        publish_command_result("session/start", "NACK", "session already active");
        return ESP_ERR_INVALID_STATE;
    }

    if (!calibration_manager_is_ready()) {
        publish_device_state(RESQ_STATE_CALIBRATION_FAIL);

        status_indicator_set(INDICATOR_STATE_CALIBRATION_FAIL);

        publish_command_result(
            "session/start",
            "NACK",
            "calibration not ready"
        );

        return ESP_ERR_INVALID_STATE;
    }

    cJSON *root = cJSON_Parse(payload);
    if (root) {
        cJSON *sid = cJSON_GetObjectItemCaseSensitive(root, "sessionId");
        if (cJSON_IsString(sid) && sid->valuestring) {
            snprintf(session_id, sizeof(session_id), "%s", sid->valuestring);
        }
        cJSON_Delete(root);
    }

    if (session_id[0] == '\0') {
        publish_command_result("session/start", "NACK", "missing sessionId");
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

    publish_device_state(RESQ_STATE_SESSION_ACTIVE);

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

    publish_device_state(RESQ_STATE_ONLINE_IDLE);

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

    publish_device_state(RESQ_STATE_RESETTING);
    
    publish_command_result("device/reset", "ACK", "reboot scheduled");
    return device_control_request_reboot();
}

static esp_err_t handle_device_unpair(const char *payload)
{
    (void)payload;

    publish_device_state(RESQ_STATE_RESETTING);

    publish_command_result(
        "device/unpair",
        "ACK",
        "unpair scheduled"
    );

    return device_control_request_unpair();
}

static void apply_calibration_config_from_json(cJSON *root, device_config_t *cfg)
{
    if (root == NULL || cfg == NULL) {
        return;
    }

    cJSON *profile_id = cJSON_GetObjectItemCaseSensitive(root, "profileId");
    if (cJSON_IsString(profile_id) && profile_id->valuestring && profile_id->valuestring[0] != '\0') {
        snprintf(
            cfg->calibration_profile_id,
            sizeof(cfg->calibration_profile_id),
            "%s",
            profile_id->valuestring
        );
    }

    cJSON *base = cJSON_GetObjectItemCaseSensitive(root, "baseReferencePressure");
    if (cJSON_IsObject(base)) {
        cJSON *force1 = cJSON_GetObjectItemCaseSensitive(base, "force1Expected");
        cJSON *force2 = cJSON_GetObjectItemCaseSensitive(base, "force2Expected");
        cJSON *tol = cJSON_GetObjectItemCaseSensitive(base, "tolerancePct");

        if (cJSON_IsNumber(force1)) {
            cfg->force1_base_reference = force1->valueint;
        }

        if (cJSON_IsNumber(force2)) {
            cfg->force2_base_reference = force2->valueint;
        }

        if (cJSON_IsNumber(tol)) {
            cfg->force_base_tolerance_pct = tol->valueint;
        }
    }

    cJSON *normal = cJSON_GetObjectItemCaseSensitive(root, "normalPosition");
    if (cJSON_IsObject(normal)) {
        cJSON *hall_tol = cJSON_GetObjectItemCaseSensitive(normal, "hallTolerance");
        cJSON *pressure_tol = cJSON_GetObjectItemCaseSensitive(normal, "pressureTolerance");

        if (cJSON_IsNumber(hall_tol)) {
            cfg->normal_hall_tolerance = hall_tol->valueint;
        }

        if (cJSON_IsNumber(pressure_tol)) {
            cfg->normal_pressure_tolerance = pressure_tol->valueint;
        }
    }

    cJSON *depth = cJSON_GetObjectItemCaseSensitive(root, "fullCompressionDepth");
    if (cJSON_IsObject(depth)) {
        cJSON *target = cJSON_GetObjectItemCaseSensitive(depth, "targetDepthMm");
        cJSON *delta = cJSON_GetObjectItemCaseSensitive(depth, "expectedHallDelta");
        cJSON *tol = cJSON_GetObjectItemCaseSensitive(depth, "deltaTolerancePct");

        if (cJSON_IsNumber(target)) {
            cfg->full_depth_target_mm = target->valueint;
        }

        if (cJSON_IsNumber(delta)) {
            cfg->full_depth_hall_delta = delta->valueint;
        }

        if (cJSON_IsNumber(tol)) {
            cfg->full_depth_tolerance_pct = tol->valueint;
        }
    }

    cJSON *recoil = cJSON_GetObjectItemCaseSensitive(root, "recoil");
    if (cJSON_IsObject(recoil)) {
        cJSON *return_delta = cJSON_GetObjectItemCaseSensitive(recoil, "returnThresholdDelta");

        if (cJSON_IsNumber(return_delta)) {
            cfg->recoil_return_threshold_delta = return_delta->valueint;
        }
    }

    cJSON *hand = cJSON_GetObjectItemCaseSensitive(root, "handPlacement");
    if (cJSON_IsObject(hand)) {
        cJSON *imbalance = cJSON_GetObjectItemCaseSensitive(hand, "maxLeftRightImbalancePct");

        if (cJSON_IsNumber(imbalance)) {
            cfg->max_pressure_imbalance_pct = imbalance->valueint;
        }
    }

    cJSON *sampling = cJSON_GetObjectItemCaseSensitive(root, "sampling");
    if (cJSON_IsObject(sampling)) {
        cJSON *window = cJSON_GetObjectItemCaseSensitive(sampling, "calibrationWindowMs");

        if (cJSON_IsNumber(window)) {
            cfg->calibration_window_ms = window->valueint;
        }
    }

    cJSON *debug = cJSON_GetObjectItemCaseSensitive(root, "debug");
    if (cJSON_IsObject(debug)) {
        cJSON *debug_raw = cJSON_GetObjectItemCaseSensitive(debug, "debugRawEnabled");

        if (cJSON_IsBool(debug_raw)) {
            cfg->debug_raw_enabled = cJSON_IsTrue(debug_raw);
        }
    }
}

static esp_err_t handle_config_update(const char *payload)
{
    if (session_manager_is_active()) {
        publish_command_result("config/update", "NACK", "cannot update config during active session");
        return ESP_ERR_INVALID_STATE;
    }

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

    apply_calibration_config_from_json(root, &new_cfg);

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

static esp_err_t handle_calibration_start(const char *payload)
{
    char profile_id[32] = {0};

    cJSON *root = cJSON_Parse(payload ? payload : "{}");
    if (root != NULL) {
        cJSON *profile = cJSON_GetObjectItemCaseSensitive(root, "profileId");

        if (cJSON_IsString(profile) &&
            profile->valuestring != NULL &&
            profile->valuestring[0] != '\0') {
            snprintf(profile_id, sizeof(profile_id), "%s", profile->valuestring);
        }

        cJSON_Delete(root);
    }

    /*
     * Current temporary behavior:
     * Until sensor_runtime supports SENSOR_MODE_CALIBRATION,
     * start the existing sensor runtime so calibration_manager can read
     * sensor_runtime_get_latest(&snap).
     *
     * Telemetry will still NOT publish because session_manager_is_active()
     * is false during calibration.
     */
    if (!sensor_runtime_is_running()) {
        esp_err_t sensor_err = sensor_runtime_start();
        if (sensor_err != ESP_OK) {
            publish_command_result(
                "calibration/start",
                "NACK",
                "failed to start sensor runtime"
            );
            return sensor_err;
        }
    }

    esp_err_t err = calibration_manager_start(
        profile_id[0] != '\0' ? profile_id : NULL
    );

    if (err != ESP_OK) {
        publish_command_result(
            "calibration/start",
            "NACK",
            "failed to start calibration"
        );
        return err;
    }

    status_indicator_set(INDICATOR_STATE_CALIBRATING);
    publish_device_state(RESQ_STATE_CALIBRATING);

    publish_command_result(
        "calibration/start",
        "ACK",
        "calibration started"
    );

    ESP_LOGI(TAG, "Calibration started");
    return ESP_OK;
}

static esp_err_t handle_calibration_capture_normal(const char *payload)
{
    (void)payload;

    if (!sensor_runtime_is_running()) {
        publish_command_result(
            "calibration/capture-normal",
            "NACK",
            "sensor runtime is not running"
        );
        return ESP_ERR_INVALID_STATE;
    }

    esp_err_t err = calibration_manager_capture_normal();

    if (err != ESP_OK) {
        publish_command_result(
            "calibration/capture-normal",
            "NACK",
            "normal capture failed"
        );
        return err;
    }

    publish_command_result(
        "calibration/capture-normal",
        "ACK",
        "normal position captured"
    );

    ESP_LOGI(TAG, "Calibration normal position captured");
    return ESP_OK;
}

static esp_err_t handle_calibration_capture_full_depth(const char *payload)
{
    (void)payload;

    if (!sensor_runtime_is_running()) {
        publish_command_result(
            "calibration/capture-full-depth",
            "NACK",
            "sensor runtime is not running"
        );
        return ESP_ERR_INVALID_STATE;
    }

    esp_err_t err = calibration_manager_capture_full_depth();

    if (err != ESP_OK) {
        publish_command_result(
            "calibration/capture-full-depth",
            "NACK",
            "full depth capture failed"
        );
        return err;
    }

    publish_command_result(
        "calibration/capture-full-depth",
        "ACK",
        "full compression depth captured"
    );

    ESP_LOGI(TAG, "Calibration full depth captured");
    return ESP_OK;
}

static esp_err_t handle_calibration_validate(const char *payload)
{
    (void)payload;

    esp_err_t err = calibration_manager_validate();

    if (err != ESP_OK) {
        publish_command_result(
            "calibration/validate",
            "NACK",
            "validation failed"
        );
        return err;
    }

    bool ready = calibration_manager_is_ready();

    if (ready) {
        status_indicator_set(INDICATOR_STATE_READY_FOR_SESSION);
        publish_device_state(RESQ_STATE_READY_FOR_SESSION);

        publish_command_result(
            "calibration/validate",
            "ACK",
            "ready for session"
        );
    } else {
        status_indicator_set(INDICATOR_STATE_CALIBRATION_FAIL);
        publish_device_state(RESQ_STATE_CALIBRATION_FAIL);

        publish_command_result(
            "calibration/validate",
            "ACK",
            "calibration failed"
        );
    }

    /*
     * Publish calibration result as event.
     * This uses your helper:
     * publish_calibration_report_event()
     */
    publish_calibration_report_event();

    /*
     * Temporary behavior:
     * Stop sensor runtime after calibration if no real session is active.
     * Later, when SENSOR_MODE_CALIBRATION is added, this will become cleaner.
     */
    if (!session_manager_is_active() && sensor_runtime_is_running()) {
        esp_err_t stop_err = sensor_runtime_stop();
        if (stop_err != ESP_OK) {
            ESP_LOGW(TAG, "failed to stop sensor runtime after calibration");
        }
    }

    ESP_LOGI(TAG, "Calibration validated: %s", ready ? "READY" : "FAILED");
    return ESP_OK;
}

static esp_err_t handle_calibration_cancel(const char *payload)
{
    (void)payload;

    esp_err_t err = calibration_manager_cancel();

    if (err != ESP_OK) {
        publish_command_result(
            "calibration/cancel",
            "NACK",
            "cancel failed"
        );
        return err;
    }

    if (!session_manager_is_active() && sensor_runtime_is_running()) {
        esp_err_t stop_err = sensor_runtime_stop();
        if (stop_err != ESP_OK) {
            ESP_LOGW(TAG, "failed to stop sensor runtime after calibration cancel");
        }
    }

    status_indicator_set(INDICATOR_STATE_ONLINE_IDLE);
    publish_device_state(RESQ_STATE_ONLINE_IDLE);

    publish_command_result(
        "calibration/cancel",
        "ACK",
        "calibration cancelled"
    );

    ESP_LOGI(TAG, "Calibration cancelled");
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
    if (suffix == NULL) {
        publish_command_result("unknown", "NACK", "missing command suffix");
        return ESP_ERR_INVALID_ARG;
    }

    if (strcmp(suffix, RESQ_SUFFIX_CMD_SESSION_START) == 0) {
        return handle_session_start(payload);
    }

    if (strcmp(suffix, RESQ_SUFFIX_CMD_SESSION_STOP) == 0) {
        return handle_session_stop(payload);
    }

    if (strcmp(suffix, RESQ_SUFFIX_CMD_DIAG_PING) == 0) {
        return handle_diag_ping(payload);
    }

    if (strcmp(suffix, RESQ_SUFFIX_CMD_DIAG_REQUEST) == 0) {
        return handle_diag_request(payload);
    }

    if (strcmp(suffix, RESQ_SUFFIX_CMD_DEVICE_RESET) == 0) {
        return handle_device_reset(payload);
    }

    if (strcmp(suffix, RESQ_SUFFIX_CMD_DEVICE_UNPAIR) == 0) {
        return handle_device_unpair(payload);
    }

    if (strcmp(suffix, RESQ_SUFFIX_CMD_CONFIG_UPDATE) == 0) {
        return handle_config_update(payload);
    }

    /*
    * New calibration / pre-check commands
    */
    if (strcmp(suffix, RESQ_SUFFIX_CMD_CALIBRATION_START) == 0) {
        return handle_calibration_start(payload);
    }

    if (strcmp(suffix, RESQ_SUFFIX_CMD_CALIBRATION_CAPTURE_NORMAL) == 0) {
        return handle_calibration_capture_normal(payload);
    }

    if (strcmp(suffix, RESQ_SUFFIX_CMD_CALIBRATION_CAPTURE_DEPTH) == 0) {
        return handle_calibration_capture_full_depth(payload);
    }

    if (strcmp(suffix, RESQ_SUFFIX_CMD_CALIBRATION_VALIDATE) == 0) {
        return handle_calibration_validate(payload);
    }

    if (strcmp(suffix, RESQ_SUFFIX_CMD_CALIBRATION_CANCEL) == 0) {
        return handle_calibration_cancel(payload);
    }

    publish_command_result("unknown", "NACK", "unsupported command suffix");
    return ESP_ERR_NOT_SUPPORTED;
}

