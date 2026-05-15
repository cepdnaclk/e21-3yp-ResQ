#include "telemetry_publisher.h"

#include <stdio.h>
#include <string.h>

#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "esp_timer.h"

#include "mqtt_manager.h"
#include "session_manager.h"
#include "cpr_metrics.h"
#include "runtime_helpers.h"

static const char *TAG = "telemetry_pub";

static TaskHandle_t s_task = NULL;
static SemaphoreHandle_t s_mutex = NULL;
static volatile bool s_running = false;

static void telemetry_task(void *arg)
{
    (void)arg;

    while (s_running) {
        if (!mqtt_manager_is_connected() || !session_manager_is_active()) {
            vTaskDelay(pdMS_TO_TICKS(200));
            continue;
        }

        cpr_metrics_snapshot_t snap = {0};
        if (cpr_metrics_get_snapshot(&snap) != ESP_OK) {
            vTaskDelay(pdMS_TO_TICKS(200));
            continue;
        }

        char payload[1024];
        const char *device_id = runtime_helpers_get_device_id(NULL);
        const char *session_id = session_manager_get_session_id();

        int written = snprintf(payload, sizeof(payload),
            "{"
            "\"event_type\":\"session_telemetry\"," 
            "\"device_id\":\"%s\"," 
            "\"session_id\":\"%s\"," 
            "\"state\":\"SESSION_ACTIVE\"," 
            "\"depth_progress\":%.3f," 
            "\"depth_ok\":%s," 
            "\"rate_cpm\":%.1f," 
            "\"compression_count\":%d," 
            "\"valid_compression_count\":%d," 
            "\"recoil_ok_count\":%d," 
            "\"incomplete_recoil_count\":%d," 
            "\"pause_s\":%.3f," 
            "\"hand_placement\":\"%s\"," 
            "\"pressure_balance_pct\":%.2f," 
            "\"flags\":\"%s\"," 
            "\"ts_ms\":%lld"
            "}",
            device_id ? device_id : "",
            session_id ? session_id : "",
            snap.depth_progress,
            snap.depth_ok ? "true" : "false",
            snap.rate_cpm,
            snap.total_compressions,
            snap.valid_compressions,
            snap.recoil_ok_count,
            snap.incomplete_recoil_count,
            snap.pause_s,
            snap.hand_placement,
            snap.pressure_balance_pct,
            snap.flags,
            (long long)snap.ts_ms
        );

        if (written > 0 && written < (int)sizeof(payload)) {
            mqtt_manager_publish_telemetry_json(payload);
        }

        vTaskDelay(pdMS_TO_TICKS(200));
    }

    vTaskDelete(NULL);
}

esp_err_t telemetry_publisher_init(void)
{
    if (s_mutex == NULL) {
        s_mutex = xSemaphoreCreateMutex();
        if (s_mutex == NULL) return ESP_ERR_NO_MEM;
    }

    s_running = false;
    s_task = NULL;

    return ESP_OK;
}

esp_err_t telemetry_publisher_start(void)
{
    if (s_mutex == NULL) return ESP_ERR_INVALID_STATE;
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(200)) != pdTRUE) return ESP_ERR_TIMEOUT;

    if (s_running) {
        xSemaphoreGive(s_mutex);
        return ESP_OK;
    }

    s_running = true;
    BaseType_t ok = xTaskCreate(telemetry_task, "telemetry_task", 4096, NULL, 5, &s_task);
    if (ok != pdPASS) {
        s_running = false;
        s_task = NULL;
        xSemaphoreGive(s_mutex);
        return ESP_FAIL;
    }

    xSemaphoreGive(s_mutex);
    return ESP_OK;
}

esp_err_t telemetry_publisher_stop(void)
{
    if (s_mutex == NULL) return ESP_ERR_INVALID_STATE;
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(200)) != pdTRUE) return ESP_ERR_TIMEOUT;

    if (!s_running) {
        xSemaphoreGive(s_mutex);
        return ESP_OK;
    }

    s_running = false;
    vTaskDelay(pdMS_TO_TICKS(100));

    xSemaphoreGive(s_mutex);
    return ESP_OK;
}

bool telemetry_publisher_is_running(void)
{
    bool running = false;
    if (s_mutex == NULL) return false;
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(50)) != pdTRUE) return false;
    running = s_running;
    xSemaphoreGive(s_mutex);
    return running;
}
