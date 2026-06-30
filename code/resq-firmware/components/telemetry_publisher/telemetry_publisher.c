#include "telemetry_publisher.h"

#include <stdio.h>
#include <string.h>

#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "esp_timer.h"

#include "mqtt_manager.h"
#include "session_manager.h"
#include "cpr_metrics.h"
#include "runtime_helpers.h"

static TaskHandle_t s_task = NULL;
static SemaphoreHandle_t s_mutex = NULL;
static EventGroupHandle_t s_task_events = NULL;
static volatile bool s_running = false;

#define TELEMETRY_TASK_STARTED_BIT BIT0
#define TELEMETRY_TASK_STOPPED_BIT BIT1
#define TELEMETRY_TASK_START_TIMEOUT_MS 1000
#define TELEMETRY_TASK_STOP_TIMEOUT_MS 1500

static void telemetry_task(void *arg)
{
    (void)arg;

    xEventGroupSetBits(s_task_events, TELEMETRY_TASK_STARTED_BIT);

    while (s_running) {
        if (!mqtt_manager_is_connected() || !session_manager_is_active()) {
            ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(200));
            continue;
        }

        cpr_metrics_snapshot_t snap = {0};
        if (cpr_metrics_get_snapshot(&snap) != ESP_OK) {
            ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(200));
            continue;
        }

        char payload[1280];
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
            "\"pressure_balance_reliable\":%s,"
            "\"pressure_saturation_mask\":%u,"
            "\"sensor_quality_flags\":%u,"
            "\"missed_pressure_samples\":%d,"
            "\"missed_hall_samples\":%d,"
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
            snap.pressure_balance_reliable ? "true" : "false",
            (unsigned int)snap.pressure_saturation_mask,
            (unsigned int)snap.sensor_quality_flags,
            snap.missed_pressure_samples,
            snap.missed_hall_samples,
            snap.flags,
            (long long)snap.ts_ms
        );

        if (written > 0 && written < (int)sizeof(payload)) {
            mqtt_manager_publish_telemetry_json(payload);
        }

        ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(200));
    }

    xSemaphoreTake(s_mutex, portMAX_DELAY);
    s_running = false;
    s_task = NULL;
    xSemaphoreGive(s_mutex);

    xEventGroupSetBits(s_task_events, TELEMETRY_TASK_STOPPED_BIT);
    vTaskDelete(NULL);
}

esp_err_t telemetry_publisher_init(void)
{
    if (s_mutex == NULL) {
        s_mutex = xSemaphoreCreateMutex();
        if (s_mutex == NULL) return ESP_ERR_NO_MEM;
    }

    if (s_task_events == NULL) {
        s_task_events = xEventGroupCreate();
        if (s_task_events == NULL) return ESP_ERR_NO_MEM;
    }

    s_running = false;
    s_task = NULL;
    xEventGroupSetBits(s_task_events, TELEMETRY_TASK_STOPPED_BIT);

    return ESP_OK;
}

esp_err_t telemetry_publisher_start(void)
{
    if (s_mutex == NULL || s_task_events == NULL) return ESP_ERR_INVALID_STATE;
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(200)) != pdTRUE) return ESP_ERR_TIMEOUT;

    if (s_task != NULL) {
        esp_err_t result = s_running ? ESP_OK : ESP_ERR_INVALID_STATE;
        xSemaphoreGive(s_mutex);
        return result;
    }

    xEventGroupClearBits(s_task_events,
                         TELEMETRY_TASK_STARTED_BIT | TELEMETRY_TASK_STOPPED_BIT);
    s_running = true;
    BaseType_t ok = xTaskCreate(telemetry_task, "telemetry_task", 4096, NULL, 5, &s_task);
    if (ok != pdPASS) {
        s_running = false;
        xSemaphoreGive(s_mutex);
        xEventGroupSetBits(s_task_events, TELEMETRY_TASK_STOPPED_BIT);
        return ESP_FAIL;
    }

    xSemaphoreGive(s_mutex);

    EventBits_t bits = xEventGroupWaitBits(
        s_task_events,
        TELEMETRY_TASK_STARTED_BIT,
        pdFALSE,
        pdTRUE,
        pdMS_TO_TICKS(TELEMETRY_TASK_START_TIMEOUT_MS));

    if ((bits & TELEMETRY_TASK_STARTED_BIT) == 0) {
        telemetry_publisher_stop();
        return ESP_ERR_TIMEOUT;
    }

    return ESP_OK;
}

esp_err_t telemetry_publisher_stop(void)
{
    if (s_mutex == NULL || s_task_events == NULL) return ESP_ERR_INVALID_STATE;
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(200)) != pdTRUE) return ESP_ERR_TIMEOUT;

    if (s_task == NULL) {
        s_running = false;
        xSemaphoreGive(s_mutex);
        return ESP_OK;
    }

    s_running = false;
    TaskHandle_t task = s_task;
    xTaskNotifyGive(task);

    xSemaphoreGive(s_mutex);

    EventBits_t bits = xEventGroupWaitBits(
        s_task_events,
        TELEMETRY_TASK_STOPPED_BIT,
        pdFALSE,
        pdTRUE,
        pdMS_TO_TICKS(TELEMETRY_TASK_STOP_TIMEOUT_MS));

    return (bits & TELEMETRY_TASK_STOPPED_BIT) ? ESP_OK : ESP_ERR_TIMEOUT;
}

bool telemetry_publisher_is_running(void)
{
    bool running = false;
    if (s_mutex == NULL) return false;
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(50)) != pdTRUE) return false;
    running = s_running && s_task != NULL;
    xSemaphoreGive(s_mutex);
    return running;
}
