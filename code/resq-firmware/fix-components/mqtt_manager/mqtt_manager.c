#include "mqtt_manager.h"

#include <stdio.h>
#include <string.h>
#include <stdint.h>

#include "cJSON.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "mqtt_client.h"
#include "esp_system.h"

static const char *TAG = "mqtt_manager";

/* Topic model */
#define RESQ_MQTT_ROOT_TOPIC    "resq"
#define RESQ_TOPIC_STATUS       "status"
#define RESQ_TOPIC_HEARTBEAT    "heartbeat"
#define RESQ_TOPIC_TELEMETRY    "telemetry"
#define RESQ_TOPIC_DEBUG        "debug"
#define RESQ_TOPIC_EVENTS       "events"
#define RESQ_TOPIC_CMD_WILDCARD "cmd/#"

#define MQTT_CONNECTED_BIT BIT0
#define MQTT_FAIL_BIT      BIT1

static esp_mqtt_client_handle_t s_client = NULL;
static bool s_connected = false;
static EventGroupHandle_t s_mqtt_events = NULL;

static char s_device_id[RESQ_DEVICE_ID_MAX_LEN + 1] = {0};
static char s_topic_cmd_wildcard[MQTT_MANAGER_TOPIC_MAX_LEN];

static esp_err_t publish_to_topic(const char *topic, const char *payload, int qos, int retain)
{
    if (s_client == NULL || !s_connected || topic == NULL || payload == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    int msg_id = esp_mqtt_client_publish(s_client, topic, payload, 0, qos, retain);
    if (msg_id < 0) {
        ESP_LOGE(TAG, "publish failed: %s", topic);
        return ESP_FAIL;
    }

    return ESP_OK;
}

static const char *select_device_id(const network_config_t *config)
{
    if (config && config->device_id[0] != '\0') {
        return config->device_id;
    }

    if (config && config->device_mac[0] != '\0') {
        return config->device_mac;
    }

    return "unknown";
}

static void build_topic_for_suffix(const char *device_id, const char *suffix, char *out, size_t out_len)
{
    snprintf(out, out_len, "%s/%s/%s", RESQ_MQTT_ROOT_TOPIC, device_id, suffix);
}

static void mqtt_event_handler(void *handler_args, esp_event_base_t base, int32_t event_id, void *event_data)
{
    (void)handler_args;
    (void)base;

    esp_mqtt_event_handle_t event = event_data;

    switch ((esp_mqtt_event_id_t)event_id) {
        case MQTT_EVENT_CONNECTED: {
            s_connected = true;
            ESP_LOGI(TAG, "MQTT connected");

            if (s_client && s_topic_cmd_wildcard[0] != '\0') {
                int msg_id = esp_mqtt_client_subscribe(s_client, s_topic_cmd_wildcard, 0);
                ESP_LOGI(TAG, "Subscribed to: %s (msg_id=%d)", s_topic_cmd_wildcard, msg_id);
            }

            if (s_mqtt_events) {
                xEventGroupSetBits(s_mqtt_events, MQTT_CONNECTED_BIT);
            }
            break;
        }
        case MQTT_EVENT_DISCONNECTED:
            s_connected = false;
            ESP_LOGW(TAG, "MQTT disconnected");
            break;

        case MQTT_EVENT_DATA: {
            char topic[MQTT_MANAGER_TOPIC_MAX_LEN];
            if (event->topic_len <= 0 || event->topic_len >= (int)sizeof(topic)) {
                ESP_LOGW(TAG, "Dropping MQTT message with invalid topic");
                break;
            }

            memcpy(topic, event->topic, event->topic_len);
            topic[event->topic_len] = '\0';

            char payload[512];
            int copy_len = event->data_len < (int)sizeof(payload) - 1 ? event->data_len : (int)sizeof(payload) - 1;
            if (copy_len > 0) {
                memcpy(payload, event->data, copy_len);
                payload[copy_len] = '\0';
            } else {
                payload[0] = '\0';
            }

            ESP_LOGI(TAG, "MQTT message received topic=%s payload=%s", topic, payload);
            break;
        }

        case MQTT_EVENT_ERROR:
            ESP_LOGE(TAG, "MQTT error");
            if (s_mqtt_events) {
                xEventGroupSetBits(s_mqtt_events, MQTT_FAIL_BIT);
            }
            break;

        default:
            break;
    }
}

esp_err_t mqtt_manager_init(void)
{
    if (s_mqtt_events == NULL) {
        s_mqtt_events = xEventGroupCreate();
        if (s_mqtt_events == NULL) {
            return ESP_ERR_NO_MEM;
        }
    }

    s_client = NULL;
    s_connected = false;

    return ESP_OK;
}

esp_err_t mqtt_manager_start(const network_config_t *config)
{
    if (config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (config->mqtt_host[0] == '\0' || config->mqtt_port <= 0) {
        return ESP_ERR_INVALID_STATE;
    }

    const char *device_id = select_device_id(config);
    snprintf(s_device_id, sizeof(s_device_id), "%s", device_id);

    snprintf(s_topic_cmd_wildcard, sizeof(s_topic_cmd_wildcard), "%s/%s/%s",
             RESQ_MQTT_ROOT_TOPIC,
             s_device_id,
             RESQ_TOPIC_CMD_WILDCARD);

    char uri[MQTT_MANAGER_URI_MAX_LEN];
    snprintf(uri, sizeof(uri), "mqtt://%s:%d", config->mqtt_host, config->mqtt_port);

    esp_mqtt_client_config_t mqtt_cfg = {
        .broker.address.uri = uri,
    };

    s_client = esp_mqtt_client_init(&mqtt_cfg);
    if (s_client == NULL) {
        return ESP_FAIL;
    }

    esp_mqtt_client_register_event(s_client, ESP_EVENT_ANY_ID, mqtt_event_handler, NULL);

    esp_err_t err = esp_mqtt_client_start(s_client);
    if (err != ESP_OK) {
        return err;
    }

    /* wait up to 10 seconds for connection */
    EventBits_t bits = xEventGroupWaitBits(s_mqtt_events, MQTT_CONNECTED_BIT | MQTT_FAIL_BIT, pdFALSE, pdFALSE, pdMS_TO_TICKS(10000));

    if (bits & MQTT_CONNECTED_BIT) {
        return ESP_OK;
    }

    if (bits & MQTT_FAIL_BIT) {
        return ESP_FAIL;
    }

    return ESP_ERR_TIMEOUT;
}

esp_err_t mqtt_manager_stop(void)
{
    if (s_client == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    esp_err_t err = esp_mqtt_client_stop(s_client);
    if (err != ESP_OK) {
        return err;
    }

    esp_mqtt_client_destroy(s_client);
    s_client = NULL;
    s_connected = false;
    return ESP_OK;
}

bool mqtt_manager_is_connected(void)
{
    return s_connected;
}

const char *mqtt_manager_get_device_id(void)
{
    return s_device_id;
}

esp_err_t mqtt_manager_publish_status(resq_state_t state,
                                      const network_config_t *network_config,
                                      const calibration_config_t *calibration_config,
                                      bool session_active,
                                      const char *session_id,
                                      const char *ip)
{
    if (!s_connected || network_config == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    char topic[MQTT_MANAGER_TOPIC_MAX_LEN];
    build_topic_for_suffix(s_device_id, RESQ_TOPIC_STATUS, topic, sizeof(topic));

    cJSON *root = cJSON_CreateObject();
    if (!root) return ESP_ERR_NO_MEM;

    cJSON_AddStringToObject(root, "device_id", select_device_id(network_config));
    cJSON_AddStringToObject(root, "state", resq_state_to_string(state));
    cJSON_AddBoolToObject(root, "session_active", session_active);
    cJSON_AddStringToObject(root, "session_id", session_id ? session_id : "");

    bool calibrated = (calibration_config && calibration_config->calibrated);
    cJSON_AddBoolToObject(root, "calibrated", calibrated);

    cJSON_AddStringToObject(root, "ip", ip ? ip : "");

    int64_t ts_ms = esp_timer_get_time() / 1000;
    cJSON_AddNumberToObject(root, "ts_ms", ts_ms);

    char *payload = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (!payload) return ESP_ERR_NO_MEM;

    esp_err_t ret = publish_to_topic(topic, payload, 1, 1);
    cJSON_free(payload);
    return ret;
}

esp_err_t mqtt_manager_publish_identity_event(const network_config_t *network_config)
{
    if (!s_connected || network_config == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    char topic[MQTT_MANAGER_TOPIC_MAX_LEN];
    build_topic_for_suffix(s_device_id, RESQ_TOPIC_EVENTS, topic, sizeof(topic));

    cJSON *root = cJSON_CreateObject();
    if (!root) return ESP_ERR_NO_MEM;

    cJSON_AddStringToObject(root, "event_type", "device_identity");
    cJSON_AddStringToObject(root, "device_id", select_device_id(network_config));
    cJSON_AddStringToObject(root, "device_mac", network_config->device_mac);
    cJSON_AddStringToObject(root, "firmware_version", "0.1.0");

    int64_t ts_ms = esp_timer_get_time() / 1000;
    cJSON_AddNumberToObject(root, "ts_ms", ts_ms);

    char *payload = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (!payload) return ESP_ERR_NO_MEM;

    esp_err_t ret = publish_to_topic(topic, payload, 1, 0);
    cJSON_free(payload);
    return ret;
}

esp_err_t mqtt_manager_publish_heartbeat(const network_config_t *network_config,
                                         const calibration_config_t *calibration_config,
                                         resq_state_t state,
                                         bool session_active,
                                         bool sensor_running,
                                         const char *session_id,
                                         const char *ip,
                                         int rssi)
{
    if (!s_connected || network_config == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    char topic[MQTT_MANAGER_TOPIC_MAX_LEN];
    build_topic_for_suffix(s_device_id, RESQ_TOPIC_HEARTBEAT, topic, sizeof(topic));

    cJSON *root = cJSON_CreateObject();
    if (!root) return ESP_ERR_NO_MEM;

    cJSON_AddStringToObject(root, "device_id", select_device_id(network_config));
    cJSON_AddStringToObject(root, "state", resq_state_to_string(state));

    bool wifi_connected = (ip && ip[0] != '\0');
    cJSON_AddBoolToObject(root, "wifi_connected", wifi_connected);
    cJSON_AddBoolToObject(root, "mqtt_connected", s_connected);

    bool backend_registered = (network_config->device_id[0] != '\0');
    cJSON_AddBoolToObject(root, "backend_registered", backend_registered);

    cJSON_AddBoolToObject(root, "session_active", session_active);
    cJSON_AddBoolToObject(root, "sensor_running", sensor_running);
    cJSON_AddStringToObject(root, "session_id", session_id ? session_id : "");

    bool calibrated = (calibration_config && calibration_config->calibrated);
    cJSON_AddBoolToObject(root, "calibrated", calibrated);

    cJSON_AddStringToObject(root, "ip", ip ? ip : "");
    cJSON_AddNumberToObject(root, "rssi", rssi);

    int64_t uptime_ms = esp_timer_get_time() / 1000;
    cJSON_AddNumberToObject(root, "uptime_ms", uptime_ms);

    int64_t ts_ms = esp_timer_get_time() / 1000;
    cJSON_AddNumberToObject(root, "ts_ms", ts_ms);

    char *payload = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (!payload) return ESP_ERR_NO_MEM;

    esp_err_t ret = publish_to_topic(topic, payload, 0, 0);
    cJSON_free(payload);
    return ret;
}

esp_err_t mqtt_manager_publish_event_json(const char *json_payload)
{
    if (!s_connected || json_payload == NULL) return ESP_ERR_INVALID_STATE;

    char topic[MQTT_MANAGER_TOPIC_MAX_LEN];
    build_topic_for_suffix(s_device_id, RESQ_TOPIC_EVENTS, topic, sizeof(topic));
    return publish_to_topic(topic, json_payload, 1, 0);
}

esp_err_t mqtt_manager_publish_telemetry_json(const char *json_payload)
{
    if (!s_connected || json_payload == NULL) return ESP_ERR_INVALID_STATE;

    char topic[MQTT_MANAGER_TOPIC_MAX_LEN];
    build_topic_for_suffix(s_device_id, RESQ_TOPIC_TELEMETRY, topic, sizeof(topic));
    return publish_to_topic(topic, json_payload, 0, 0);
}

esp_err_t mqtt_manager_publish_debug_json(const char *json_payload)
{
    if (!s_connected || json_payload == NULL) return ESP_ERR_INVALID_STATE;

    char topic[MQTT_MANAGER_TOPIC_MAX_LEN];
    build_topic_for_suffix(s_device_id, RESQ_TOPIC_DEBUG, topic, sizeof(topic));
    return publish_to_topic(topic, json_payload, 0, 0);
}
