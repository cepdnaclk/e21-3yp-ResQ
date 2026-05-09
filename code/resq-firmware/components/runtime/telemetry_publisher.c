#include "telemetry_publisher.h"

#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "esp_err.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "event_publisher.h"
#include "resq_protocol.h"
#include "sensor_runtime.h"
#include "session_manager.h"
#include "config_store.h"

#define TELEMETRY_TASK_STACK_SIZE 4096
#define TELEMETRY_TASK_PRIORITY      4
#define TELEMETRY_PERIOD_MS        200

static const char *TAG = "telemetry_publisher";

static TaskHandle_t s_task_handle = NULL;
static device_config_t s_cfg;

static void append_flag(char *out, size_t out_len, bool *first, const char *flag)
{
    if (out == NULL || out_len == 0 || first == NULL || flag == NULL) {
        return;
    }

    size_t used = strlen(out);
    if (used >= out_len - 1) {
        return;
    }

    snprintf(
        out + used,
        out_len - used,
        "%s\"%s\"",
        *first ? "" : ",",
        flag
    );

    *first = false;
}

static void flags_to_json(uint32_t flags, char *out, size_t out_len)
{
    if (out == NULL || out_len == 0) {
        return;
    }

    snprintf(out, out_len, "[");
    bool first = true;

    if ((flags & SENSOR_FLAG_DEPTH_LOW) != 0) {
        append_flag(out, out_len, &first, "DEPTH_LOW");
    }
    if ((flags & SENSOR_FLAG_DEPTH_HIGH) != 0) {
        append_flag(out, out_len, &first, "DEPTH_HIGH");
    }
    if ((flags & SENSOR_FLAG_RATE_LOW) != 0) {
        append_flag(out, out_len, &first, "RATE_LOW");
    }
    if ((flags & SENSOR_FLAG_RATE_HIGH) != 0) {
        append_flag(out, out_len, &first, "RATE_HIGH");
    }
    if ((flags & SENSOR_FLAG_RECOIL_POOR) != 0) {
        append_flag(out, out_len, &first, "RECOIL_POOR");
    }
    if ((flags & SENSOR_FLAG_PAUSE_LONG) != 0) {
        append_flag(out, out_len, &first, "PAUSE_LONG");
    }
    if ((flags & SENSOR_FLAG_HAND_OFFCENTER) != 0) {
        append_flag(out, out_len, &first, "HAND_OFFCENTER");
    }
    if ((flags & SENSOR_FLAG_SENSOR_FAULT) != 0) {
        append_flag(out, out_len, &first, "SENSOR_FAULT");
    }

    size_t used = strlen(out);
    if (used < out_len - 1) {
        snprintf(out + used, out_len - used, "]");
    }
}

static void publish_telemetry_packet(const sensor_snapshot_t *snap)
{
    char session_id[64] = {0};
    session_manager_get_session_id(session_id, sizeof(session_id));

    char flags_json[160];
    flags_to_json(snap->flags, flags_json, sizeof(flags_json));

    char payload[768];
    esp_err_t err = resq_payload_metric_telemetry(
        s_cfg.device_id,
        s_cfg.manikin_id,
        session_id,
        snap->ts_ms,
        snap->depth_mm,
        snap->rate_cpm,
        snap->recoil_ok,
        snap->pause_s,
        snap->total_compressions,
        snap->hand_placement,
        flags_json,
        s_cfg.debug_raw_enabled,
        snap,
        payload,
        sizeof(payload)
    );

    if (err == ESP_OK) {
        event_publisher_publish_or_queue(RESQ_SUFFIX_TELEMETRY, payload, 0, 0);
    } else {
        ESP_LOGW(TAG, "failed to build metric telemetry: %s", esp_err_to_name(err));
    }
}

static void publish_feedback_event(const sensor_snapshot_t *snap)
{
    char session_id[64] = {0};
    session_manager_get_session_id(session_id, sizeof(session_id));

    char *payload = resq_payload_feedback_event(
        s_cfg.device_id,
        session_id,
        snap
    );

    if (payload) {
        event_publisher_publish_or_queue(RESQ_SUFFIX_EVENTS, payload, 1, 0);
        cJSON_free(payload);
    }
}

static void telemetry_task(void *arg)
{
    (void)arg;

    int last_event_count = -1;

    while (1) {
        if (event_publisher_is_connected() &&
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
