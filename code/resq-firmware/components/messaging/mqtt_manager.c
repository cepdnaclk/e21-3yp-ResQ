#include "mqtt_manager.h"

#include <stdio.h>
#include <string.h>
#include <stdint.h>

#include "cJSON.h"
#include "esp_event.h"
#include "esp_log.h"
#include "mqtt_client.h"
#include "sensor_runtime.h"
#include "session_manager.h"
#include "command_handler.h"
#include "resq_protocol.h"
#include "config_store.h"

static const char *TAG = "mqtt_manager";

static esp_mqtt_client_handle_t s_client = NULL;
static bool s_connected = false;
static device_config_t s_cfg;

static char s_lwt_topic[128];
static char s_lwt_msg[256];

static esp_err_t build_topic(char *out, size_t out_len, const char *suffix)
{
    return resq_build_topic(s_cfg.device_id, suffix, out, out_len);
}

esp_err_t mqtt_manager_publish(const char *suffix, const char *payload, int qos, int retain)
{
    if (s_client == NULL || !s_connected || suffix == NULL || payload == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    char topic[128];
    esp_err_t err = build_topic(topic, sizeof(topic), suffix);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "failed to build publish topic for suffix=%s", suffix);
        return err;
    }

    int msg_id = esp_mqtt_client_publish(s_client, topic, payload, 0, qos, retain);
    if (msg_id < 0) {
        return ESP_FAIL;
    }

    return ESP_OK;
}

static void publish_state(const char *state)
{
    char *payload = resq_payload_status(
        s_cfg.device_id,
        state,
        session_manager_is_active(),
        session_manager_get_id()
    );

    if (payload) {
        mqtt_manager_publish(RESQ_SUFFIX_STATUS, payload, 1, 1);
        cJSON_free(payload);
    }
}

static esp_err_t mqtt_subscribe_suffix(const char *device_id, const char *suffix, int qos)
{
    if (!device_id || !suffix || device_id[0] == '\0') {
        ESP_LOGW(TAG, "cannot subscribe, missing device_id or suffix");
        return ESP_ERR_INVALID_ARG;
    }

    char topic[160];

    esp_err_t err = resq_build_topic(
        device_id,
        suffix,
        topic,
        sizeof(topic)
    );

    if (err != ESP_OK) {
        ESP_LOGE(TAG, "failed to build subscribe topic for suffix=%s", suffix);
        return err;
    }

    int msg_id = esp_mqtt_client_subscribe(s_client, topic, qos);

    if (msg_id < 0) {
        ESP_LOGE(TAG, "subscribe failed: %s", topic);
        return ESP_FAIL;
    }

    ESP_LOGI(TAG, "subscribed: %s", topic);
    return ESP_OK;
}

static void mqtt_event_handler(
    void *handler_args,
    esp_event_base_t base,
    int32_t event_id,
    void *event_data
)
{
    (void)handler_args;
    (void)base;

    esp_mqtt_event_handle_t event = event_data;

    switch ((esp_mqtt_event_id_t)event_id) {
        case MQTT_EVENT_CONNECTED: {
            s_connected = true;
            ESP_LOGI(TAG, "MQTT connected");

            mqtt_subscribe_suffix(s_cfg.device_id, RESQ_SUFFIX_CMD_SESSION_START, 1);
            mqtt_subscribe_suffix(s_cfg.device_id, RESQ_SUFFIX_CMD_SESSION_STOP, 1);
            mqtt_subscribe_suffix(s_cfg.device_id, RESQ_SUFFIX_CMD_DIAG_PING, 1);
            mqtt_subscribe_suffix(s_cfg.device_id, RESQ_SUFFIX_CMD_DIAG_REQUEST, 1);
            mqtt_subscribe_suffix(s_cfg.device_id, RESQ_SUFFIX_CMD_DEVICE_RESET, 1);
            mqtt_subscribe_suffix(s_cfg.device_id, RESQ_SUFFIX_CMD_DEVICE_UNPAIR, 1);
            mqtt_subscribe_suffix(s_cfg.device_id, RESQ_SUFFIX_CMD_CONFIG_UPDATE, 1);

            mqtt_subscribe_suffix(s_cfg.device_id, RESQ_SUFFIX_CMD_CALIBRATION_START, 1);
            mqtt_subscribe_suffix(s_cfg.device_id, RESQ_SUFFIX_CMD_CALIBRATION_CAPTURE_NORMAL, 1);
            mqtt_subscribe_suffix(s_cfg.device_id, RESQ_SUFFIX_CMD_CALIBRATION_CAPTURE_DEPTH, 1);
            mqtt_subscribe_suffix(s_cfg.device_id, RESQ_SUFFIX_CMD_CALIBRATION_VALIDATE, 1);
            mqtt_subscribe_suffix(s_cfg.device_id, RESQ_SUFFIX_CMD_CALIBRATION_CANCEL, 1);

            publish_state("ONLINE");
            break;
        }

        case MQTT_EVENT_DISCONNECTED:
            s_connected = false;
            ESP_LOGW(TAG, "MQTT disconnected");
            break;

        case MQTT_EVENT_DATA: {
            char topic[128] = {0};
            char data[512] = {0};

            int topic_len = (event->topic_len < (int)sizeof(topic) - 1) ? event->topic_len : (int)sizeof(topic) - 1;
            int data_len  = (event->data_len  < (int)sizeof(data)  - 1) ? event->data_len  : (int)sizeof(data)  - 1;

            memcpy(topic, event->topic, topic_len);
            memcpy(data, event->data, data_len);

            char prefix[96];
            snprintf(prefix, sizeof(prefix), "resq/manikins/%s/", s_cfg.device_id);

            const char *suffix = topic;
            if (strncmp(topic, prefix, strlen(prefix)) == 0) {
                suffix = topic + strlen(prefix);
            }

            esp_err_t err = command_handler_handle_message(suffix, data);
            if (err != ESP_OK && err != ESP_ERR_NOT_SUPPORTED) {
                ESP_LOGW(TAG, "Command handler failed for %s: %s", suffix, esp_err_to_name(err));
            }

            break;
        }

        default:
            break;
    }
}

esp_err_t mqtt_manager_init(const device_config_t *cfg)
{
    if (cfg == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (cfg->mqtt_host[0] == '\0' || cfg->mqtt_port <= 0 || cfg->device_id[0] == '\0') {
        return ESP_ERR_INVALID_STATE;
    }

    s_cfg = *cfg;

    char uri[128];
    snprintf(uri, sizeof(uri), "mqtt://%s:%d", s_cfg.mqtt_host, s_cfg.mqtt_port);

    esp_err_t err = build_topic(s_lwt_topic, sizeof(s_lwt_topic), RESQ_SUFFIX_STATUS);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "failed to build LWT topic");
        return err;
    }

    char *offline_payload = resq_payload_status(
        s_cfg.device_id,
        "OFFLINE",
        false,
        ""
    );

    if (offline_payload == NULL) {
        return ESP_ERR_NO_MEM;
    }

    snprintf(s_lwt_msg, sizeof(s_lwt_msg), "%s", offline_payload);
    cJSON_free(offline_payload);

    esp_mqtt_client_config_t mqtt_cfg = {
        .broker.address.uri = uri,
        .session.last_will.topic = s_lwt_topic,
        .session.last_will.msg = s_lwt_msg,
        .session.last_will.qos = 1,
        .session.last_will.retain = true,
    };

    s_client = esp_mqtt_client_init(&mqtt_cfg);
    if (s_client == NULL) {
        return ESP_FAIL;
    }

    esp_mqtt_client_register_event(s_client, ESP_EVENT_ANY_ID, mqtt_event_handler, NULL);

    return ESP_OK;
}

esp_err_t mqtt_manager_start(void)
{
    if (s_client == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    return esp_mqtt_client_start(s_client);
}

bool mqtt_manager_is_connected(void)
{
    return s_connected;
}
