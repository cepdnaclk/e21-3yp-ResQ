#include "event_publisher.h"

#include <string.h>

#include "cJSON.h"
#include "esp_log.h"
#include "mqtt_manager.h"
#include "queued_publisher.h"
#include "resq_protocol.h"

static const char *TAG = "event_publisher";

static device_config_t s_cfg = {0};
static bool s_initialized = false;

esp_err_t event_publisher_init(const device_config_t *cfg)
{
    if (cfg == NULL) {
        ESP_LOGE(TAG, "device config is NULL");
        return ESP_ERR_INVALID_ARG;
    }

    s_cfg = *cfg;
    s_initialized = true;
    
    ESP_LOGI(TAG, "event_publisher initialized for device_id=%s", s_cfg.device_id);
    return ESP_OK;
}

bool event_publisher_is_connected(void)
{
    return mqtt_manager_is_connected();
}

esp_err_t event_publisher_publish_or_queue(
    const char *suffix,
    const char *payload,
    int qos,
    int retain
)
{
    if (!s_initialized) {
        ESP_LOGE(TAG, "event_publisher_publish_or_queue: not initialized");
        return ESP_ERR_INVALID_STATE;
    }

    if (suffix == NULL || payload == NULL) {
        ESP_LOGE(TAG, "event_publisher_publish_or_queue: invalid suffix or payload");
        return ESP_ERR_INVALID_ARG;
    }

    return queued_publisher_publish_or_queue(suffix, payload, qos, retain);
}

esp_err_t event_publisher_publish_status(
    const char *state,
    bool session_active,
    const char *session_id
)
{
    if (!s_initialized) {
        ESP_LOGE(TAG, "event_publisher_publish_status: not initialized");
        return ESP_ERR_INVALID_STATE;
    }

    if (state == NULL) {
        ESP_LOGE(TAG, "event_publisher_publish_status: state is NULL");
        return ESP_ERR_INVALID_ARG;
    }

    if (session_id == NULL) {
        ESP_LOGE(TAG, "event_publisher_publish_status: session_id is NULL");
        return ESP_ERR_INVALID_ARG;
    }

    char *payload = resq_payload_status(
        s_cfg.device_id,
        state,
        session_active,
        session_id
    );

    if (payload == NULL) {
        ESP_LOGE(TAG, "event_publisher_publish_status: failed to build payload");
        return ESP_FAIL;
    }

    esp_err_t err = queued_publisher_publish_or_queue(
        RESQ_SUFFIX_STATUS,
        payload,
        1,   /* QoS 1 */
        1    /* retain true */
    );

    cJSON_free(payload);
    return err;
}

esp_err_t event_publisher_publish_command_result(
    const char *command,
    const char *status,
    const char *reason,
    const char *session_id
)
{
    if (!s_initialized) {
        ESP_LOGE(TAG, "event_publisher_publish_command_result: not initialized");
        return ESP_ERR_INVALID_STATE;
    }

    if (command == NULL || status == NULL || session_id == NULL) {
        ESP_LOGE(TAG, "event_publisher_publish_command_result: invalid arguments");
        return ESP_ERR_INVALID_ARG;
    }

    char *payload = resq_payload_command_result(
        s_cfg.device_id,
        session_id,
        command,
        status,
        reason
    );

    if (payload == NULL) {
        ESP_LOGE(TAG, "event_publisher_publish_command_result: failed to build payload");
        return ESP_FAIL;
    }

    esp_err_t err = queued_publisher_publish_or_queue(
        RESQ_SUFFIX_EVENTS,
        payload,
        1,   /* QoS 1 */
        0    /* retain false */
    );

    cJSON_free(payload);
    return err;
}

esp_err_t event_publisher_publish_fault(
    const char *session_id,
    const char *fault_code,
    const char *message,
    bool active
)
{
    if (!s_initialized) {
        ESP_LOGE(TAG, "event_publisher_publish_fault: not initialized");
        return ESP_ERR_INVALID_STATE;
    }

    if (session_id == NULL || fault_code == NULL || message == NULL) {
        ESP_LOGE(TAG, "event_publisher_publish_fault: invalid arguments");
        return ESP_ERR_INVALID_ARG;
    }

    char *payload = resq_payload_fault_event(
        s_cfg.device_id,
        session_id,
        fault_code,
        message,
        active
    );

    if (payload == NULL) {
        ESP_LOGE(TAG, "event_publisher_publish_fault: failed to build payload");
        return ESP_FAIL;
    }

    esp_err_t err = queued_publisher_publish_or_queue(
        RESQ_SUFFIX_EVENTS,
        payload,
        1,   /* QoS 1 */
        0    /* retain false */
    );

    cJSON_free(payload);
    return err;
}
