#include "health_monitor.h"

#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "mqtt_manager.h"
#include "sensor_runtime.h"
#include "session_manager.h"
#include "wifi_manager.h"

#define HEALTH_TASK_STACK_SIZE 4096
#define HEALTH_TASK_PRIORITY      3
#define HEARTBEAT_PERIOD_MS    5000
#define WIFI_RETRY_PERIOD_MS  10000

static const char *TAG = "health_monitor";

static TaskHandle_t s_task_handle = NULL;
static device_config_t s_cfg;

static void publish_heartbeat(void)
{
    sensor_snapshot_t snap = {0};
    bool have_snap = (sensor_runtime_get_latest(&snap) == ESP_OK);

    char ip_str[16] = {0};
    bool ip_ok = (wifi_manager_get_ip(ip_str, sizeof(ip_str)) == ESP_OK);

    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "device_id", s_cfg.device_id);
    cJSON_AddStringToObject(root, "manikin_id", s_cfg.manikin_id);

    cJSON_AddBoolToObject(root, "wifi_connected", wifi_manager_is_connected());
    cJSON_AddBoolToObject(root, "mqtt_connected", mqtt_manager_is_connected());
    cJSON_AddBoolToObject(root, "session_active", session_manager_is_active());
    cJSON_AddBoolToObject(root, "sensor_running", sensor_runtime_is_running());

    cJSON_AddStringToObject(root, "session_id", session_manager_get_id());
    cJSON_AddStringToObject(root, "ip", ip_ok ? ip_str : "");

    if (have_snap) {
        cJSON_AddBoolToObject(root, "force1_ok", snap.force1_ok);
        cJSON_AddBoolToObject(root, "force2_ok", snap.force2_ok);
        cJSON_AddBoolToObject(root, "hall_ok", snap.hall_ok);
        cJSON_AddNumberToObject(root, "compression_count", snap.total_compressions);
    } else {
        cJSON_AddBoolToObject(root, "force1_ok", false);
        cJSON_AddBoolToObject(root, "force2_ok", false);
        cJSON_AddBoolToObject(root, "hall_ok", false);
        cJSON_AddNumberToObject(root, "compression_count", 0);
    }

    char *payload = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);

    if (payload) {
        mqtt_manager_publish("heartbeat", payload, 0, 0);
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

        if (mqtt_manager_is_connected()) {
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