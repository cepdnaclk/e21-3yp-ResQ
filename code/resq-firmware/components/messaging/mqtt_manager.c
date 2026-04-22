#include "mqtt_manager.h"

#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "esp_event.h"
#include "esp_log.h"
#include "mqtt_client.h"
#include "sensor_runtime.h"
#include "session_manager.h"

static const char *TAG = "mqtt_manager";

static esp_mqtt_client_handle_t s_client = NULL;
static bool s_connected = false;
static device_config_t s_cfg;

static void build_topic(char *out, size_t out_len, const char *suffix)
{
    snprintf(out, out_len, "resq/manikins/%s/%s", s_cfg.device_id, suffix);
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
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "device_id", s_cfg.device_id);
    cJSON_AddStringToObject(root, "state", state);
    cJSON_AddBoolToObject(root, "session_active", session_manager_is_active());
    cJSON_AddStringToObject(root, "session_id", session_manager_get_id());

    char *payload = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);

    if (payload) {
        mqtt_manager_publish("status", payload, 1, 1);
        cJSON_free(payload);
    }
}

static void handle_session_start(const char *data)
{
    char session_id[64] = {0};

    cJSON *root = cJSON_Parse(data);
    if (root) {
        cJSON *sid = cJSON_GetObjectItemCaseSensitive(root, "session_id");
        if (cJSON_IsString(sid) && sid->valuestring) {
            snprintf(session_id, sizeof(session_id), "%s", sid->valuestring);
        }
        cJSON_Delete(root);
    }

    if (session_id[0] == '\0') {
        snprintf(session_id, sizeof(session_id), "unknown");
    }

    ESP_LOGI(TAG, "SESSION START received: %s", session_id);

    session_manager_start(session_id);
    sensor_runtime_reset_session_data();
    sensor_runtime_start();

    publish_state("SESSION_ACTIVE");
}

static void handle_session_stop(const char *data)
{
    (void)data;

    ESP_LOGI(TAG, "SESSION STOP received");

    sensor_runtime_stop();
    session_manager_stop();

    publish_state("IDLE");
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

            char topic_start[128];
            char topic_stop[128];

            build_topic(topic_start, sizeof(topic_start), "cmd/session/start");
            build_topic(topic_stop, sizeof(topic_stop), "cmd/session/stop");

            esp_mqtt_client_subscribe(s_client, topic_start, 1);
            esp_mqtt_client_subscribe(s_client, topic_stop, 1);

            publish_state("IDLE");
            break;
        }

        case MQTT_EVENT_DISCONNECTED:
            s_connected = false;
            ESP_LOGW(TAG, "MQTT disconnected");
            break;

        case MQTT_EVENT_DATA: {
            char topic[128] = {0};
            char data[256] = {0};

            int topic_len = (event->topic_len < (int)sizeof(topic) - 1) ? event->topic_len : (int)sizeof(topic) - 1;
            int data_len  = (event->data_len  < (int)sizeof(data)  - 1) ? event->data_len  : (int)sizeof(data)  - 1;

            memcpy(topic, event->topic, topic_len);
            memcpy(data, event->data, data_len);

            char topic_start[128];
            char topic_stop[128];

            build_topic(topic_start, sizeof(topic_start), "cmd/session/start");
            build_topic(topic_stop, sizeof(topic_stop), "cmd/session/stop");

            if (strcmp(topic, topic_start) == 0) {
                handle_session_start(data);
            } else if (strcmp(topic, topic_stop) == 0) {
                handle_session_stop(data);
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

    esp_mqtt_client_config_t mqtt_cfg = {
        .broker.address.uri = uri,
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