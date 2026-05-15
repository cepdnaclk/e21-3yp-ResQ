#include "runtime_helpers.h"

#include <stdio.h>
#include <string.h>

#include "esp_log.h"
#include "esp_timer.h"

#include "mqtt_manager.h"
#include "config_store.h"

static const char *TAG = "runtime_helpers";

static int64_t runtime_helpers_now_ms(void)
{
    return esp_timer_get_time() / 1000;
}

const char *runtime_helpers_get_device_id(const network_config_t *config)
{
    (void)config;

    const char *did = mqtt_manager_get_device_id();
    if (did && did[0] != '\0') {
        return did;
    }

    static char macbuf[RESQ_DEVICE_MAC_MAX_LEN] = {0};
    if (config_store_get_device_mac(macbuf, sizeof(macbuf)) == ESP_OK && macbuf[0] != '\0') {
        return macbuf;
    }

    return "unknown";
}

const char *runtime_helpers_get_command_suffix(const char *topic)
{
    if (topic == NULL) {
        return NULL;
    }

    const char *cmd_pos = strstr(topic, "/cmd/");
    if (cmd_pos == NULL) {
        return NULL;
    }

    return cmd_pos + 1;
}

esp_err_t runtime_helpers_publish_error_event(const network_config_t *network_config,
                                              resq_state_t state,
                                              const char *error_code,
                                              const char *message)
{
    char payload[512];

    int written = snprintf(payload,
                           sizeof(payload),
                           "{"
                           "\"event_type\":\"error\"," 
                           "\"device_id\":\"%s\"," 
                           "\"state\":\"%s\"," 
                           "\"error_code\":\"%s\"," 
                           "\"message\":\"%s\"," 
                           "\"ts_ms\":%lld"
                           "}",
                           runtime_helpers_get_device_id(network_config),
                           resq_state_to_string(state),
                           error_code != NULL ? error_code : "UNKNOWN_ERROR",
                           message != NULL ? message : "",
                           (long long)runtime_helpers_now_ms());

    if (written <= 0 || written >= (int)sizeof(payload)) {
        return ESP_ERR_INVALID_SIZE;
    }

    ESP_LOGE(TAG,
             "State error state=%s code=%s message=%s",
             resq_state_to_string(state),
             error_code != NULL ? error_code : "UNKNOWN_ERROR",
             message != NULL ? message : "");

    if (!mqtt_manager_is_connected()) {
        return ESP_ERR_INVALID_STATE;
    }

    return mqtt_manager_publish_topic_json("events/error", payload);
}

esp_err_t runtime_helpers_publish_command_result(const network_config_t *network_config,
                                                 resq_state_t state,
                                                 const char *command,
                                                 const char *status,
                                                 const char *reason)
{
    char payload[512];

    int written = snprintf(payload,
                           sizeof(payload),
                           "{"
                           "\"event_type\":\"command_result\"," 
                           "\"device_id\":\"%s\"," 
                           "\"command\":\"%s\"," 
                           "\"status\":\"%s\"," 
                           "\"reason\":\"%s\"," 
                           "\"state\":\"%s\"," 
                           "\"ts_ms\":%lld"
                           "}",
                           runtime_helpers_get_device_id(network_config),
                           command != NULL ? command : "",
                           status != NULL ? status : "",
                           reason != NULL ? reason : "",
                           resq_state_to_string(state),
                           (long long)runtime_helpers_now_ms());

    if (written <= 0 || written >= (int)sizeof(payload)) {
        return ESP_ERR_INVALID_SIZE;
    }

    if (!mqtt_manager_is_connected()) {
        return ESP_ERR_INVALID_STATE;
    }

    return mqtt_manager_publish_event_json(payload);
}
