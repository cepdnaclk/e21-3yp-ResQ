#include "recovery_manager.h"

#include <string.h>

#include "cJSON.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "mqtt_manager.h"
#include "queued_publisher.h"
#include "resq_protocol.h"
#include "sensor_runtime.h"
#include "session_manager.h"
#include "wifi_manager.h"

#define RECOVERY_TASK_STACK_SIZE 4096
#define RECOVERY_TASK_PRIORITY      3
#define RECOVERY_PERIOD_MS       1000

static const char *TAG = "recovery_mgr";

static TaskHandle_t s_task_handle = NULL;
static device_config_t s_cfg;

static bool s_prev_wifi = false;
static bool s_prev_mqtt = false;

/* Set when an active session was aborted because connectivity was lost */
static bool s_session_aborted_due_to_link_loss = false;

static void publish_system_event(const char *event_type, const char *message)
{
    cJSON *root = cJSON_CreateObject();
    if (!root) {
        return;
    }

    cJSON_AddStringToObject(root, "device_id", s_cfg.device_id);
    cJSON_AddStringToObject(root, "session_id", session_manager_get_id());
    cJSON_AddStringToObject(root, "event_type", event_type);
    cJSON_AddStringToObject(root, "message", message);

    char *payload = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);

    if (payload) {
        queued_publisher_publish_or_queue(RESQ_SUFFIX_EVENTS, payload, 1, 0);
        cJSON_free(payload);
    }
}

static void abort_active_session_due_to_disconnect(const char *reason)
{
    if (!session_manager_is_active()) {
        return;
    }

    ESP_LOGW(TAG, "Aborting active session due to connectivity loss: %s", reason);

    sensor_runtime_stop();
    session_manager_stop();

    s_session_aborted_due_to_link_loss = true;

    publish_system_event("session_aborted", reason);
}

static void recovery_task(void *arg)
{
    (void)arg;

    while (1) {
        bool wifi_ok = wifi_manager_is_connected();
        bool mqtt_ok = mqtt_manager_is_connected();

        /* Detect connectivity loss while a session is active */
        if (session_manager_is_active()) {
            if (!wifi_ok) {
                abort_active_session_due_to_disconnect("Wi-Fi disconnected during active session");
            } else if (!mqtt_ok) {
                abort_active_session_due_to_disconnect("MQTT disconnected during active session");
            }
        }

        /* Publish edge transitions */
        if (wifi_ok != s_prev_wifi) {
            if (wifi_ok) {
                ESP_LOGI(TAG, "Wi-Fi recovered");
                publish_system_event("wifi_recovered", "Wi-Fi connection restored");
            } else {
                ESP_LOGW(TAG, "Wi-Fi lost");
                publish_system_event("wifi_lost", "Wi-Fi connection lost");
            }
            s_prev_wifi = wifi_ok;
        }

        if (mqtt_ok != s_prev_mqtt) {
            if (mqtt_ok) {
                ESP_LOGI(TAG, "MQTT recovered");
                publish_system_event("mqtt_recovered", "MQTT connection restored");

                if (s_session_aborted_due_to_link_loss) {
                    publish_system_event(
                        "session_recovery_required",
                        "Previous session was aborted; waiting for Local Hub to send a new session/start"
                    );
                    s_session_aborted_due_to_link_loss = false;
                }
            } else {
                ESP_LOGW(TAG, "MQTT lost");
                publish_system_event("mqtt_lost", "MQTT connection lost");
            }
            s_prev_mqtt = mqtt_ok;
        }

        vTaskDelay(pdMS_TO_TICKS(RECOVERY_PERIOD_MS));
    }
}

esp_err_t recovery_manager_init(const device_config_t *cfg)
{
    if (cfg == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    s_cfg = *cfg;
    s_prev_wifi = false;
    s_prev_mqtt = false;
    s_session_aborted_due_to_link_loss = false;

    return ESP_OK;
}

esp_err_t recovery_manager_start(void)
{
    if (s_task_handle != NULL) {
        return ESP_OK;
    }

    BaseType_t ok = xTaskCreate(
        recovery_task,
        "recovery_task",
        RECOVERY_TASK_STACK_SIZE,
        NULL,
        RECOVERY_TASK_PRIORITY,
        &s_task_handle
    );

    return (ok == pdPASS) ? ESP_OK : ESP_FAIL;
}