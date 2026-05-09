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

static const char *TAG = "mqtt_manager";

static esp_mqtt_client_handle_t s_client = NULL;
static bool s_connected = false;
static device_config_t s_cfg;

static char s_lwt_topic[128];
static char s_lwt_msg[256];

static void build_topic(char *out, size_t out_len, const char *suffix)
{
    resq_topic_build(out, out_len, s_cfg.device_id, suffix);
}

esp_err_t mqtt_manager_publish(const char *suffix, const char *payload, int qos, int retain)
{
    if (s_client == NULL || !s_connected || suffix == NULL || payload == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    char topic[128];
    build_topic(topic, sizeof(topic), suffix);

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

            char topic[128];

            build_topic(topic, sizeof(topic), RESQ_SUFFIX_CMD_SESSION_START);
            esp_mqtt_client_subscribe(s_client, topic, 1);

            build_topic(topic, sizeof(topic), RESQ_SUFFIX_CMD_SESSION_STOP);
            esp_mqtt_client_subscribe(s_client, topic, 1);

            build_topic(topic, sizeof(topic), RESQ_SUFFIX_CMD_DIAG_PING);
            esp_mqtt_client_subscribe(s_client, topic, 1);

            build_topic(topic, sizeof(topic), RESQ_SUFFIX_CMD_DIAG_REQUEST);
            esp_mqtt_client_subscribe(s_client, topic, 1);

            build_topic(topic, sizeof(topic), RESQ_SUFFIX_CMD_DEVICE_RESET);
            esp_mqtt_client_subscribe(s_client, topic, 1);

            build_topic(topic, sizeof(topic), RESQ_SUFFIX_CMD_DEVICE_UNPAIR);
            esp_mqtt_client_subscribe(s_client, topic, 1);

            build_topic(topic, sizeof(topic), RESQ_SUFFIX_CMD_CONFIG_UPDATE);
            esp_mqtt_client_subscribe(s_client, topic, 1);

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

    resq_topic_build(s_lwt_topic, sizeof(s_lwt_topic), s_cfg.device_id, RESQ_SUFFIX_STATUS);

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