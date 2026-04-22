#include "telemetry_publisher.h"

#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "mqtt_manager.h"
#include "sensor_runtime.h"
#include "session_manager.h"

#define TELEMETRY_TASK_STACK_SIZE 4096
#define TELEMETRY_TASK_PRIORITY      4
#define TELEMETRY_PERIOD_MS        200

static const char *TAG = "telemetry_pub";

static TaskHandle_t s_task_handle = NULL;
static device_config_t s_cfg;

static void publish_telemetry_packet(const sensor_snapshot_t *snap)
{
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "device_id", s_cfg.device_id);
    cJSON_AddStringToObject(root, "manikin_id", s_cfg.manikin_id);
    cJSON_AddStringToObject(root, "session_id", session_manager_get_id());

    cJSON_AddNumberToObject(root, "force1", snap->force1);
    cJSON_AddNumberToObject(root, "force2", snap->force2);
    cJSON_AddBoolToObject(root, "force1_ok", snap->force1_ok);
    cJSON_AddBoolToObject(root, "force2_ok", snap->force2_ok);

    cJSON_AddBoolToObject(root, "hall_ok", snap->hall_ok);
    cJSON_AddNumberToObject(root, "hall_raw", snap->hall_raw);
    cJSON_AddNumberToObject(root, "current_delta", snap->current_delta);

    cJSON_AddNumberToObject(root, "total_compressions", snap->total_compressions);
    cJSON_AddStringToObject(root, "feedback", cpr_feedback_to_string(snap->feedback));

    char *payload = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);

    if (payload) {
        mqtt_manager_publish("telemetry", payload, 0, 0);
        cJSON_free(payload);
    }
}

static void publish_feedback_event(const sensor_snapshot_t *snap)
{
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "device_id", s_cfg.device_id);
    cJSON_AddStringToObject(root, "session_id", session_manager_get_id());
    cJSON_AddStringToObject(root, "event_type", "compression_feedback");
    cJSON_AddNumberToObject(root, "compression_count", snap->total_compressions);
    cJSON_AddStringToObject(root, "feedback", cpr_feedback_to_string(snap->feedback));
    cJSON_AddNumberToObject(root, "current_delta", snap->current_delta);

    char *payload = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);

    if (payload) {
        mqtt_manager_publish("events", payload, 1, 0);
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