#include "health_monitor.h"

#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "event_publisher.h"
#include "sensor_runtime.h"
#include "session_manager.h"
#include "wifi_manager.h"
#include "resq_protocol.h"
#include "calibration_manager.h"
#include "esp_timer.h"

#define HEALTH_TASK_STACK_SIZE 4096
#define HEALTH_TASK_PRIORITY      3
#define HEARTBEAT_PERIOD_MS    5000
#define WIFI_RETRY_PERIOD_MS  10000

static const char *TAG = "health_monitor";

static TaskHandle_t s_task_handle = NULL;
static device_config_t s_cfg;

static const char *sensor_mode_to_string(sensor_mode_t mode)
{
    switch (mode) {
    case SENSOR_MODE_IDLE:
        return "IDLE";
    case SENSOR_MODE_CALIBRATION:
        return "CALIBRATION";
    case SENSOR_MODE_SESSION:
        return "SESSION";
    default:
        return "UNKNOWN";
    }
}

static void publish_heartbeat(void)
{
    sensor_snapshot_t snap = {0};
    bool have_snap = (sensor_runtime_get_latest(&snap) == ESP_OK);

    char ip_str[16] = {0};
    bool ip_ok = (wifi_manager_get_ip(ip_str, sizeof(ip_str)) == ESP_OK);

    char session_id[64] = {0};
    session_manager_get_session_id(session_id, sizeof(session_id));

    calibration_report_t report = {0};
    bool have_report = calibration_manager_get_report_copy(&report);
    calibration_result_t cal_result = have_report ? report.result : calibration_manager_get_result();

    char *payload = resq_payload_heartbeat(
        s_cfg.device_id,
        wifi_manager_is_connected(),
        event_publisher_is_connected(),
        session_manager_is_active(),
        sensor_runtime_is_running(),
        session_id,
        ip_ok ? ip_str : "",
        have_snap ? snap.force1_ok : false,
        have_snap ? snap.force2_ok : false,
        have_snap ? snap.hall_ok : false,
        have_snap ? snap.total_compressions : 0,
        calibration_manager_is_ready(),
        calibration_manager_result_to_string(cal_result),
        have_report ? report.profile_id : s_cfg.calibration_profile_id,
        calibration_manager_result_to_string(cal_result),
        s_cfg.debug_raw_enabled,
        sensor_mode_to_string(sensor_runtime_get_mode())
    );

    if (payload) {
        event_publisher_publish_or_queue(RESQ_SUFFIX_HEARTBEAT, payload, 0, 0);
        cJSON_free(payload);
    }
}

static void health_task(void *arg)
{
    (void)arg;

    TickType_t last_heartbeat = 0;
    TickType_t last_wifi_retry = 0;

    while (1) {
        TickType_t now = xTaskGetTickCount();

        if (!wifi_manager_is_connected()) {
            if ((now - last_wifi_retry) >= pdMS_TO_TICKS(WIFI_RETRY_PERIOD_MS)) {
                last_wifi_retry = now;
                ESP_LOGW(TAG, "Wi-Fi disconnected, retrying...");
                esp_err_t err = wifi_manager_reconnect_last(pdMS_TO_TICKS(15000));
                if (err == ESP_OK) {
                    ESP_LOGI(TAG, "Wi-Fi reconnect succeeded");
                } else {
                    ESP_LOGW(TAG, "Wi-Fi reconnect failed: %s", esp_err_to_name(err));
                }
            }
        }

        /* Publish a minimal heartbeat periodically to indicate liveness. */
        if ((now - last_heartbeat) >= pdMS_TO_TICKS(HEARTBEAT_PERIOD_MS)) {
            last_heartbeat = now;
            publish_heartbeat();
        }

        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}

esp_err_t health_monitor_init(const device_config_t *cfg)
{
    if (cfg == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    s_cfg = *cfg;
    return ESP_OK;
}

esp_err_t health_monitor_start(void)
{
    if (s_task_handle != NULL) {
        return ESP_OK;
    }

    BaseType_t ok = xTaskCreate(
        health_task,
        "health_task",
        HEALTH_TASK_STACK_SIZE,
        NULL,
        HEALTH_TASK_PRIORITY,
        &s_task_handle
    );

    return (ok == pdPASS) ? ESP_OK : ESP_FAIL;
}

esp_err_t health_monitor_publish_now(bool include_debug_raw)
{
    /* Build a richer diagnostic health event and publish it on the events topic */
    cJSON *root = cJSON_CreateObject();
    if (root == NULL) {
        return ESP_ERR_NO_MEM;
    }

    /* Determine profile id and last calibration result from most recent report */
    calibration_report_t report = {0};
    bool have_report = calibration_manager_get_report_copy(&report);
    calibration_result_t cal_result = have_report ? report.result : calibration_manager_get_result();
    const char *profile_id = have_report ? report.profile_id : s_cfg.calibration_profile_id;

    sensor_snapshot_t snap = {0};
    bool have_snap = (sensor_runtime_get_latest(&snap) == ESP_OK);

    char ip_str[16] = {0};
    bool ip_ok = (wifi_manager_get_ip(ip_str, sizeof(ip_str)) == ESP_OK);

    char session_id[64] = {0};
    session_manager_get_session_id(session_id, sizeof(session_id));

    cJSON_AddStringToObject(root, "event_type", "diagnostic_health");
    cJSON_AddStringToObject(root, "device_id", s_cfg.device_id);
    cJSON_AddBoolToObject(root, "wifi_connected", wifi_manager_is_connected());
    cJSON_AddBoolToObject(root, "mqtt_connected", event_publisher_is_connected());
    cJSON_AddBoolToObject(root, "session_active", session_manager_is_active());
    cJSON_AddBoolToObject(root, "sensor_running", sensor_runtime_is_running());
    cJSON_AddStringToObject(root, "session_id", session_id);
    cJSON_AddStringToObject(root, "ip", ip_ok ? ip_str : "");

    cJSON_AddBoolToObject(root, "force1_ok", have_snap ? snap.force1_ok : false);
    cJSON_AddBoolToObject(root, "force2_ok", have_snap ? snap.force2_ok : false);
    cJSON_AddBoolToObject(root, "hall_ok", have_snap ? snap.hall_ok : false);
    cJSON_AddNumberToObject(root, "compression_count", have_snap ? snap.total_compressions : 0);

    cJSON_AddBoolToObject(root, "calibrationReady", calibration_manager_is_ready());
    cJSON_AddStringToObject(root, "calibrationState", calibration_manager_result_to_string(cal_result));
    cJSON_AddStringToObject(root, "profileId", profile_id ? profile_id : "");
    cJSON_AddStringToObject(root, "lastCalibrationResult", calibration_manager_result_to_string(cal_result));

    cJSON_AddBoolToObject(root, "debugRawEnabled", s_cfg.debug_raw_enabled);
    cJSON_AddStringToObject(root, "sensorMode", sensor_mode_to_string(sensor_runtime_get_mode()));

    /* Uptime in milliseconds */
    int64_t uptime_ms = esp_timer_get_time() / 1000LL;
    cJSON_AddNumberToObject(root, "uptimeMs", (double)uptime_ms);

    /* Optionally include raw debug readings when requested or enabled */
    if (include_debug_raw || s_cfg.debug_raw_enabled) {
        if (have_snap) {
            cJSON *debug_raw = cJSON_AddObjectToObject(root, "debugRaw");
            if (debug_raw != NULL) {
                cJSON_AddNumberToObject(debug_raw, "force1", snap.force1);
                cJSON_AddNumberToObject(debug_raw, "force2", snap.force2);
                cJSON_AddNumberToObject(debug_raw, "hallRaw", snap.hall_raw);
                cJSON_AddNumberToObject(debug_raw, "hallFiltered", snap.hall_filtered);
                cJSON_AddNumberToObject(debug_raw, "currentDelta", snap.current_delta);
            }
        } else {
            cJSON *debug_raw = cJSON_AddObjectToObject(root, "debugRaw");
            if (debug_raw != NULL) {
                cJSON_AddNumberToObject(debug_raw, "force1", 0);
                cJSON_AddNumberToObject(debug_raw, "force2", 0);
                cJSON_AddNumberToObject(debug_raw, "hallRaw", 0);
                cJSON_AddNumberToObject(debug_raw, "hallFiltered", 0);
                cJSON_AddNumberToObject(debug_raw, "currentDelta", 0);
            }
        }
    }

    char *payload = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);

    if (payload == NULL) {
        return ESP_ERR_NO_MEM;
    }

    esp_err_t err = event_publisher_publish_or_queue(RESQ_SUFFIX_EVENTS, payload, 1, 0);
    cJSON_free(payload);

    return err;
}
