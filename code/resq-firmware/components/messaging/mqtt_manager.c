#include "mqtt_manager.h"

#include <stdio.h>
#include <string.h>
#include <stdint.h>

#include "cJSON.h"
#include "esp_event.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "mqtt_client.h"
#include "resq_protocol.h"
#include "config_store.h"

static const char *TAG = "mqtt_manager";

static esp_mqtt_client_handle_t s_client = NULL;
static bool s_connected = false;
static device_config_t s_cfg;

static char s_lwt_topic[128];
static char s_lwt_msg[256];

#define COMMAND_QUEUE_LENGTH          8
#define COMMAND_SUFFIX_MAX_LEN       96
#define COMMAND_PAYLOAD_MAX_LEN    1536
#define COMMAND_TASK_STACK_SIZE    4096
#define COMMAND_TASK_PRIORITY         4

typedef struct {
    char suffix[COMMAND_SUFFIX_MAX_LEN];
    char payload[COMMAND_PAYLOAD_MAX_LEN];
    bool oversized;
    int payload_len;
} command_queue_item_t;

static QueueHandle_t s_command_queue = NULL;
static TaskHandle_t s_command_task_handle = NULL;

static mqtt_command_handler_cb_t s_command_handle_cb = NULL;
static mqtt_command_reject_cb_t s_command_reject_cb = NULL;
static void *s_command_cb_ctx = NULL;

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

static void command_worker_task(void *arg)
{
    (void)arg;

    command_queue_item_t item;

    while (1) {
        if (xQueueReceive(s_command_queue, &item, portMAX_DELAY) != pdTRUE) {
            continue;
        }

        if (item.oversized) {
            ESP_LOGW(
                TAG,
                "Rejecting oversized command suffix=%s payload_len=%d max=%d",
                item.suffix,
                item.payload_len,
                COMMAND_PAYLOAD_MAX_LEN - 1
            );
            if (s_command_reject_cb != NULL) {
                s_command_reject_cb(item.suffix, "payload too large", s_command_cb_ctx);
            } else {
                ESP_LOGW(TAG, "rejecting command without reject callback: suffix=%s reason=payload too large",
                         item.suffix);
            }
            continue;
        }

        if (s_command_handle_cb != NULL) {
            esp_err_t err = s_command_handle_cb(item.suffix, item.payload, s_command_cb_ctx);
            if (err != ESP_OK && err != ESP_ERR_NOT_SUPPORTED) {
                ESP_LOGW(TAG, "Command handler callback failed for %s: %s", item.suffix, esp_err_to_name(err));
            }
        } else {
            ESP_LOGW(TAG, "command received but no command handler callback is registered: suffix=%s",
                     item.suffix);
        }
    }
}

static esp_err_t command_queue_init(void)
{
    if (s_command_queue == NULL) {
        s_command_queue = xQueueCreate(COMMAND_QUEUE_LENGTH, sizeof(command_queue_item_t));
        if (s_command_queue == NULL) {
            ESP_LOGE(TAG, "failed to create command queue");
            return ESP_ERR_NO_MEM;
        }
    }

    if (s_command_task_handle == NULL) {
        BaseType_t ok = xTaskCreate(
            command_worker_task,
            "mqtt_cmd_worker",
            COMMAND_TASK_STACK_SIZE,
            NULL,
            COMMAND_TASK_PRIORITY,
            &s_command_task_handle
        );

        if (ok != pdPASS) {
            ESP_LOGE(TAG, "failed to start command worker");
            return ESP_FAIL;
        }
    }

    return ESP_OK;
}

static void enqueue_command_or_reject(
    const char *suffix,
    const char *payload,
    int payload_len,
    bool oversized
)
{
    command_queue_item_t item = {0};
    snprintf(item.suffix, sizeof(item.suffix), "%s", suffix ? suffix : "unknown");
    item.oversized = oversized;
    item.payload_len = payload_len;

    if (!oversized && payload != NULL && payload_len > 0) {
        memcpy(item.payload, payload, (size_t)payload_len);
        item.payload[payload_len] = '\0';
    }

    if (s_command_queue == NULL ||
        xQueueSend(s_command_queue, &item, 0) != pdTRUE) {
        ESP_LOGW(TAG, "Command queue full, rejecting suffix=%s", item.suffix);
        if (s_command_reject_cb != NULL) {
            s_command_reject_cb(item.suffix, "command queue full", s_command_cb_ctx);
        } else {
            ESP_LOGW(TAG, "rejecting command without reject callback: suffix=%s reason=command queue full",
                     item.suffix);
        }
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

            break;
        }

        case MQTT_EVENT_DISCONNECTED:
            s_connected = false;
            ESP_LOGW(TAG, "MQTT disconnected");
            break;

        case MQTT_EVENT_DATA: {
            char topic[160] = {0};

            if (event->topic_len <= 0 ||
                event->topic_len >= (int)sizeof(topic)) {
                ESP_LOGW(TAG, "Dropping MQTT command with invalid/long topic");
                break;
            }

            memcpy(topic, event->topic, event->topic_len);
            topic[event->topic_len] = '\0';

            char prefix[96];
            snprintf(prefix, sizeof(prefix), "resq/manikins/%s/", s_cfg.device_id);

            const char *suffix = topic;
            if (strncmp(topic, prefix, strlen(prefix)) == 0) {
                suffix = topic + strlen(prefix);
            }

            if (strlen(suffix) >= COMMAND_SUFFIX_MAX_LEN) {
                ESP_LOGW(TAG, "Dropping MQTT command with long suffix");
                break;
            }

            bool fragmented =
                event->total_data_len > 0 &&
                event->total_data_len != event->data_len;

            bool oversized =
                fragmented ||
                event->data_len >= COMMAND_PAYLOAD_MAX_LEN;

            if (oversized) {
                enqueue_command_or_reject(
                    suffix,
                    NULL,
                    event->total_data_len > 0 ? event->total_data_len : event->data_len,
                    true
                );
                break;
            }

            enqueue_command_or_reject(suffix, event->data, event->data_len, false);
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

    esp_err_t err = command_queue_init();
    if (err != ESP_OK) {
        return err;
    }

    char uri[128];
    snprintf(uri, sizeof(uri), "mqtt://%s:%d", s_cfg.mqtt_host, s_cfg.mqtt_port);

    err = build_topic(s_lwt_topic, sizeof(s_lwt_topic), RESQ_SUFFIX_STATUS);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "failed to build LWT topic");
        return err;
    }

    char *offline_payload = resq_payload_status(
        s_cfg.device_id,
        RESQ_STATE_OFFLINE,
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

esp_err_t mqtt_manager_set_command_callbacks(
    mqtt_command_handler_cb_t handle_cb,
    mqtt_command_reject_cb_t reject_cb,
    void *ctx
)
{
    if (handle_cb == NULL) {
        ESP_LOGE(TAG, "command handler callback is required");
        return ESP_ERR_INVALID_ARG;
    }

    s_command_handle_cb = handle_cb;
    s_command_reject_cb = reject_cb;
    s_command_cb_ctx = ctx;

    ESP_LOGI(TAG, "command callbacks registered");
    return ESP_OK;
}
