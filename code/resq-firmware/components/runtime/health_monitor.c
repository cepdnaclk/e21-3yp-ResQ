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
        s_cfg.manikin_id,
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

esp_err_t health_monitor_publish_heartbeat(void)
{
    publish_heartbeat();
    return ESP_OK;
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

        if (event_publisher_is_connected()) {
            if ((now - last_heartbeat) >= pdMS_TO_TICKS(HEARTBEAT_PERIOD_MS)) {
                last_heartbeat = now;
                publish_heartbeat();
            }
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
