#include "telemetry_publisher.h"

#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "mqtt_manager.h"
#include "resq_protocol.h"
#include "sensor_runtime.h"
#include "session_manager.h"

#define TELEMETRY_TASK_STACK_SIZE 4096
#define TELEMETRY_TASK_PRIORITY      4
#define TELEMETRY_PERIOD_MS        200

static TaskHandle_t s_task_handle = NULL;
static device_config_t s_cfg;

static void publish_telemetry_packet(const sensor_snapshot_t *snap)
{
    char *payload = resq_payload_telemetry(
        s_cfg.device_id,
        s_cfg.manikin_id,
        session_manager_get_id(),
        snap
    );

    if (payload) {
        mqtt_manager_publish(RESQ_SUFFIX_TELEMETRY, payload, 0, 0);
        cJSON_free(payload);
    }
}

static void publish_feedback_event(const sensor_snapshot_t *snap)
{
    char *payload = resq_payload_feedback_event(
        s_cfg.device_id,
        session_manager_get_id(),
        snap
    );

    if (payload) {
        mqtt_manager_publish(RESQ_SUFFIX_EVENTS, payload, 1, 0);
        cJSON_free(payload);
    }
}

static void telemetry_task(void *arg)
{
    (void)arg;

    int last_event_count = -1;

    while (1) {
        if (mqtt_manager_is_connected() &&
            session_manager_is_active() &&
            sensor_runtime_is_running()) {

            sensor_snapshot_t snap;
            if (sensor_runtime_get_latest(&snap) == ESP_OK) {
                publish_telemetry_packet(&snap);

                if (snap.feedback != CPR_FEEDBACK_NONE &&
                    snap.total_compressions != last_event_count) {
                    publish_feedback_event(&snap);
                    last_event_count = snap.total_compressions;
                }
            }
        } else {
            last_event_count = -1;
        }

        vTaskDelay(pdMS_TO_TICKS(TELEMETRY_PERIOD_MS));
    }
}

esp_err_t telemetry_publisher_init(const device_config_t *cfg)
{
    if (cfg == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    s_cfg = *cfg;
    return ESP_OK;
}

esp_err_t telemetry_publisher_start(void)
{
    if (s_task_handle != NULL) {
        return ESP_OK;
    }

    BaseType_t ok = xTaskCreate(
        telemetry_task,
        "telemetry_task",
        TELEMETRY_TASK_STACK_SIZE,
        NULL,
        TELEMETRY_TASK_PRIORITY,
        &s_task_handle
    );

    return (ok == pdPASS) ? ESP_OK : ESP_FAIL;
}