#include "runtime_helpers.h"

#include <stdio.h>
#include <string.h>

#include "esp_log.h"
#include "esp_timer.h"

#include "mqtt_manager.h"
#include "config_store.h"
#include "board_config.h"
#include "hx710.h"
#include "hall_sensor.h"
#include "esp_timer.h"

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

esp_err_t runtime_helpers_publish_debug_snapshot(const network_config_t *network_config)
{
    if (network_config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    int32_t pressure_0_raw = hx710_read(BOARD_HX710_0_SCK, BOARD_HX710_0_DOUT);
    if (pressure_0_raw == HX710_ERROR_TIMEOUT) {
        return ESP_FAIL;
    }

    int32_t pressure_1_raw = hx710_read(BOARD_HX710_1_SCK, BOARD_HX710_1_DOUT);
    if (pressure_1_raw == HX710_ERROR_TIMEOUT) {
        return ESP_FAIL;
    }

    int32_t pressure_2_raw = hx710_read(BOARD_HX710_2_SCK, BOARD_HX710_2_DOUT);
    if (pressure_2_raw == HX710_ERROR_TIMEOUT) {
        return ESP_FAIL;
    }

    int hall_raw = 0;
    hall_sensor_t local_hall = {0};

    esp_err_t hall_err = hall_sensor_init(&local_hall, BOARD_HALL_ADC_CHAN);
    if (hall_err != ESP_OK) {
        return hall_err;
    }

    hall_err = hall_sensor_read_raw(&local_hall, &hall_raw);
    if (hall_err != ESP_OK) {
        return hall_err;
    }

    char payload[384];

    int written = snprintf(payload,
                           sizeof(payload),
                           "{"
                           "\"device_id\":\"%s\"," 
                           "\"pressure_0_raw\":%ld," 
                           "\"pressure_1_raw\":%ld," 
                           "\"pressure_2_raw\":%ld," 
                           "\"hall_raw\":%d," 
                           "\"ts_ms\":%lld"
                           "}",
                           runtime_helpers_get_device_id(network_config),
                           (long)pressure_0_raw,
                           (long)pressure_1_raw,
                           (long)pressure_2_raw,
                           hall_raw,
                           (long long)(esp_timer_get_time() / 1000));

    if (written <= 0 || written >= (int)sizeof(payload)) {
        return ESP_ERR_INVALID_SIZE;
    }

    return mqtt_manager_publish_debug_json(payload);
}
