#include "fault_reporter.h"

#include <string.h>

#include "cJSON.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "mqtt_manager.h"
#include "resq_protocol.h"
#include "sensor_runtime.h"
#include "session_manager.h"

#define FAULT_TASK_STACK_SIZE 4096
#define FAULT_TASK_PRIORITY      3
#define FAULT_TASK_PERIOD_MS   500

static const char *TAG = "fault_reporter";

static TaskHandle_t s_task_handle = NULL;
static device_config_t s_cfg;

static bool s_prev_force1_ok = true;
static bool s_prev_force2_ok = true;
static bool s_prev_hall_ok   = true;
static bool s_prev_valid     = false;

static void publish_fault(const char *fault_code, const char *message, bool active)
{
    char *payload = resq_payload_fault_event(
        s_cfg.device_id,
        session_manager_get_id(),
        fault_code,
        message,
        active
    );

    if (payload) {
        mqtt_manager_publish(RESQ_SUFFIX_EVENTS, payload, 1, 0);
        cJSON_free(payload);
    }
}

static void fault_task(void *arg)
{
    (void)arg;

    while (1) {
        if (mqtt_manager_is_connected() &&
            session_manager_is_active() &&
            sensor_runtime_is_running()) {

            sensor_snapshot_t snap;
            if (sensor_runtime_get_latest(&snap) == ESP_OK) {
                if (!s_prev_valid) {
                    s_prev_force1_ok = snap.force1_ok;
                    s_prev_force2_ok = snap.force2_ok;
                    s_prev_hall_ok   = snap.hall_ok;
                    s_prev_valid = true;
                }

                if (snap.force1_ok != s_prev_force1_ok) {
                    publish_fault(
                        "force1",
                        snap.force1_ok ? "Force sensor 1 recovered" : "Force sensor 1 timeout/disconnected",
                        !snap.force1_ok
                    );
                    s_prev_force1_ok = snap.force1_ok;
                }

                if (snap.force2_ok != s_prev_force2_ok) {
                    publish_fault(
                        "force2",
                        snap.force2_ok ? "Force sensor 2 recovered" : "Force sensor 2 timeout/disconnected",
                        !snap.force2_ok
                    );
                    s_prev_force2_ok = snap.force2_ok;
                }

                if (snap.hall_ok != s_prev_hall_ok) {
                    publish_fault(
                        "hall",
                        snap.hall_ok ? "Hall sensor recovered" : "Hall sensor read failed",
                        !snap.hall_ok
                    );
                    s_prev_hall_ok = snap.hall_ok;
                }
            }
        } else {
            s_prev_valid = false;
        }

        vTaskDelay(pdMS_TO_TICKS(FAULT_TASK_PERIOD_MS));
    }
}

esp_err_t fault_reporter_init(const device_config_t *cfg)
{
    if (cfg == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    s_cfg = *cfg;
    s_prev_valid = false;
    return ESP_OK;
}

esp_err_t fault_reporter_start(void)
{
    if (s_task_handle != NULL) {
        return ESP_OK;
    }

    BaseType_t ok = xTaskCreate(
        fault_task,
        "fault_task",
        FAULT_TASK_STACK_SIZE,
        NULL,
        FAULT_TASK_PRIORITY,
        &s_task_handle
    );

    if (ok != pdPASS) {
        ESP_LOGE(TAG, "Failed to start fault task");
        return ESP_FAIL;
    }

    return ESP_OK;
}