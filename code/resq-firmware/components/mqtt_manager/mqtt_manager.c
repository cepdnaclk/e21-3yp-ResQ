#include "mqtt_manager.h"

#include <stdio.h>
#include <string.h>
#include <stdint.h>

#include "cJSON.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/queue.h"
#include "mqtt_client.h"
#include "esp_system.h"
#include "config_store.h"

static const char *TAG = "mqtt_manager";

static const char *calibration_pressure_mode_to_string(calibration_pressure_mode_t mode)
{
    switch (mode) {
        case CALIBRATION_PRESSURE_REQUIRED:
            return "REQUIRED";
        case CALIBRATION_PRESSURE_OPTIONAL:
            return "OPTIONAL";
        case CALIBRATION_HALL_ONLY:
            return "HALL_ONLY";
        case CALIBRATION_HALL_WITH_LAST_STABLE_PRESSURE:
            return "HALL_WITH_LAST_STABLE_PRESSURE";
        default:
            return "OPTIONAL";
    }
}

static bool calibration_pressure_kpa_ready(const calibration_config_t *calibration)
{
    return calibration != NULL &&
           calibration->calibrated &&
           calibration->pressure_valid &&
           !calibration->pressure_degraded &&
           calibration->pressure_0_baseline != 0 &&
           calibration->pressure_1_baseline != 0 &&
           calibration->pressure_2_baseline != 0 &&
           calibration->pressure_0_kpa_per_count > 0.0f &&
           calibration->pressure_1_kpa_per_count > 0.0f &&
           calibration->pressure_2_kpa_per_count > 0.0f;
}

static bool calibration_hall_mm_ready(const calibration_config_t *calibration)
{
    return calibration != NULL &&
           calibration->calibrated &&
           calibration->hall_valid &&
           calibration->hall_baseline > 0 &&
           calibration->hall_range_raw > 0 &&
           calibration->full_depth_mm > 0.0f &&
           (calibration->hall_direction == 1 || calibration->hall_direction == -1);
}

static void add_conversion_readiness_fields(cJSON *root,
                                            const calibration_config_t *calibration)
{
    bool pressure_ready = calibration_pressure_kpa_ready(calibration);
    bool hall_ready = calibration_hall_mm_ready(calibration);

    cJSON_AddNumberToObject(root, "full_depth_mm", calibration ? calibration->full_depth_mm : 0.0f);
    cJSON_AddBoolToObject(root, "pressure_kpa_calibrated", pressure_ready);
    cJSON_AddBoolToObject(root, "hall_mm_calibrated", hall_ready);
    cJSON_AddBoolToObject(root, "pressure_kpa_valid", pressure_ready);
    cJSON_AddBoolToObject(root, "hall_mm_valid", hall_ready);
}

/* Topic model centralized in mqtt_topics.h */
#include "mqtt_topics.h"

#define MQTT_CONNECTED_BIT BIT0
#define MQTT_FAIL_BIT      BIT1

static esp_mqtt_client_handle_t s_client = NULL;
static bool s_connected = false;
static volatile mqtt_manager_reconnect_status_t s_reconnect_status =
    MQTT_MANAGER_RECONNECT_IDLE;
static EventGroupHandle_t s_mqtt_events = NULL;
static QueueHandle_t s_command_queue = NULL;

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

static const char *select_device_id_runtime(void)
{
    if (s_device_id[0] != '\0') {
        return s_device_id;
    }

    /* Fall back to hardware MAC if device_id not set */
    static char macbuf[RESQ_DEVICE_MAC_MAX_LEN] = {0};
    if (config_store_get_device_mac(macbuf, sizeof(macbuf)) == ESP_OK && macbuf[0] != '\0') {
        return macbuf;
    }

    return "unknown";
}

/* Wrapper to maintain existing internal usage while delegating to centralized helper */
static void build_topic_for_suffix(const char *device_id, const char *suffix, char *out, size_t out_len)
{
    /* ignore result here; callers generally don't expect failure for internal topics */
    (void)resq_mqtt_build_topic(device_id, suffix, out, out_len);
}

/* Implementation of centralized topic builder declared in mqtt_topics.h */
esp_err_t resq_mqtt_build_topic(const char *device_id, const char *suffix, char *out, size_t out_len)
{
    if (device_id == NULL || device_id[0] == '\0' || suffix == NULL || suffix[0] == '\0' || out == NULL || out_len == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    int needed = snprintf(out, out_len, "%s/%s/%s", RESQ_MQTT_ROOT_TOPIC, device_id, suffix);
    if (needed < 0) return ESP_FAIL;
    if ((size_t)needed >= out_len) return ESP_ERR_INVALID_SIZE;
    return ESP_OK;
}

static void mqtt_event_handler(void *handler_args, esp_event_base_t base, int32_t event_id, void *event_data)
{
    (void)handler_args;
    (void)base;

    esp_mqtt_event_handle_t event = event_data;

    switch ((esp_mqtt_event_id_t)event_id) {
        case MQTT_EVENT_CONNECTED: {
            s_connected = true;
            s_reconnect_status = MQTT_MANAGER_RECONNECT_CONNECTED;
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
            s_reconnect_status = MQTT_MANAGER_RECONNECT_IN_PROGRESS;
            ESP_LOGW(TAG, "MQTT disconnected");
            break;

        case MQTT_EVENT_DATA:
        {
            if (event->topic_len <= 0) {
                ESP_LOGW(TAG, "Dropping MQTT message with empty topic");
                break;
            }

            resq_mqtt_command_t command = {0};

            /*
            * MQTT event topic/data are not null-terminated.
            * So we copy them into fixed-size buffers and add '\0'.
            */
            int topic_copy_len = event->topic_len;

            if (topic_copy_len >= MQTT_MANAGER_COMMAND_TOPIC_MAX_LEN) {
                ESP_LOGW(TAG, "MQTT topic too long. Truncating.");
                topic_copy_len = MQTT_MANAGER_COMMAND_TOPIC_MAX_LEN - 1;
            }

            memcpy(command.topic, event->topic, topic_copy_len);
            command.topic[topic_copy_len] = '\0';

            int payload_copy_len = event->data_len;

            if (payload_copy_len < 0) {
                payload_copy_len = 0;
            }

            if (payload_copy_len >= MQTT_MANAGER_COMMAND_PAYLOAD_MAX_LEN) {
                ESP_LOGW(TAG, "MQTT payload too long. Truncating.");
                payload_copy_len = MQTT_MANAGER_COMMAND_PAYLOAD_MAX_LEN - 1;
            }

            if (payload_copy_len > 0) {
                memcpy(command.payload, event->data, payload_copy_len);
            }

            command.payload[payload_copy_len] = '\0';
            command.payload_len = payload_copy_len;

            ESP_LOGI(TAG,
                    "MQTT message received topic=%s payload=%s",
                    command.topic,
                    command.payload);

            /*
            * Only command topics should enter the firmware command queue.
            * Published topics like status, heartbeat, telemetry, debug, and events
            * should not be processed as commands.
            */
            if (strstr(command.topic, "/cmd/") != NULL) {
                if (s_command_queue == NULL) {
                    ESP_LOGW(TAG, "Command queue not initialized. Command dropped.");
                    break;
                }

                BaseType_t ok = xQueueSend(s_command_queue,
                                        &command,
                                        0);

                if (ok != pdTRUE) {
                    ESP_LOGW(TAG, "MQTT command queue full. Command dropped.");
                }
            }

            break;
        }

        case MQTT_EVENT_ERROR:
            s_reconnect_status = MQTT_MANAGER_RECONNECT_FAILED;
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

    if (s_command_queue == NULL) {
        s_command_queue = xQueueCreate(MQTT_MANAGER_COMMAND_QUEUE_LEN,
                                       sizeof(resq_mqtt_command_t));
        if (s_command_queue == NULL) {
            return ESP_ERR_NO_MEM;
        }
    }

    s_client = NULL;
    s_connected = false;
    s_reconnect_status = MQTT_MANAGER_RECONNECT_IDLE;

    return ESP_OK;
}

esp_err_t mqtt_manager_start(const char *device_id,
                            const char *mqtt_host,
                            int mqtt_port)
{
    if (mqtt_host == NULL || mqtt_host[0] == '\0' || mqtt_port <= 0) {
        return ESP_ERR_INVALID_ARG;
    }

    /* Set runtime device id (may be empty) */
    if (device_id != NULL) {
        snprintf(s_device_id, sizeof(s_device_id), "%s", device_id);
    } else {
        s_device_id[0] = '\0';
    }

    /* Build subscription wildcard topic: resq/{device}/cmd/# */
    (void)resq_mqtt_build_topic(select_device_id_runtime(), RESQ_SUFFIX_CMD_ROOT, s_topic_cmd_wildcard, sizeof(s_topic_cmd_wildcard));

    char uri[MQTT_MANAGER_URI_MAX_LEN];
    snprintf(uri, sizeof(uri), "mqtt://%s:%d", mqtt_host, mqtt_port);

    esp_mqtt_client_config_t mqtt_cfg = {
        .broker.address.uri = uri,
    };

    /* If an existing client is active, stop it first to avoid stale state */
    if (s_client != NULL) {
        mqtt_manager_stop();
    }

    s_client = esp_mqtt_client_init(&mqtt_cfg);
    if (s_client == NULL) {
        return ESP_FAIL;
    }

    /* Clear previous event bits before starting a new connection */
    if (s_mqtt_events) {
        xEventGroupClearBits(s_mqtt_events, MQTT_CONNECTED_BIT | MQTT_FAIL_BIT);
    }
    s_reconnect_status = MQTT_MANAGER_RECONNECT_IN_PROGRESS;

    esp_err_t reg_err = esp_mqtt_client_register_event(
        s_client,
        ESP_EVENT_ANY_ID,
        mqtt_event_handler,
        NULL
    );

    if (reg_err != ESP_OK) {
        esp_mqtt_client_destroy(s_client);
        s_client = NULL;
        s_reconnect_status = MQTT_MANAGER_RECONNECT_FAILED;
        return reg_err;
    }

    esp_err_t err = esp_mqtt_client_start(s_client);
    if (err != ESP_OK) {
        esp_mqtt_client_destroy(s_client);
        s_client = NULL;
        s_connected = false;
        s_reconnect_status = MQTT_MANAGER_RECONNECT_FAILED;
        return err;
    }

    /* wait up to 10 seconds for connection */
    EventBits_t bits = xEventGroupWaitBits(
        s_mqtt_events,
        MQTT_CONNECTED_BIT | MQTT_FAIL_BIT,
        pdFALSE,
        pdFALSE,
        pdMS_TO_TICKS(10000)
    );

    if (bits & MQTT_CONNECTED_BIT) {
        s_reconnect_status = MQTT_MANAGER_RECONNECT_CONNECTED;
        return ESP_OK;
    }

    /* Connection failed or timed out: cleanup client */
    if (bits & MQTT_FAIL_BIT) {
        if (s_client != NULL) {
            esp_mqtt_client_stop(s_client);
            esp_mqtt_client_destroy(s_client);
            s_client = NULL;
        }
        s_connected = false;
        s_reconnect_status = MQTT_MANAGER_RECONNECT_FAILED;
        return ESP_FAIL;
    }

    /* Timeout */
    if (s_client != NULL) {
        esp_mqtt_client_stop(s_client);
        esp_mqtt_client_destroy(s_client);
        s_client = NULL;
    }
    s_connected = false;
    s_reconnect_status = MQTT_MANAGER_RECONNECT_FAILED;
    return ESP_ERR_TIMEOUT;
}

esp_err_t mqtt_manager_stop(void)
{
    if (s_client == NULL) {
        s_connected = false;
        s_reconnect_status = MQTT_MANAGER_RECONNECT_IDLE;
        return ESP_OK;
    }

    esp_err_t err = esp_mqtt_client_stop(s_client);
    if (err != ESP_OK) {
        /* attempt to destroy client anyway */
        esp_mqtt_client_destroy(s_client);
        s_client = NULL;
        s_connected = false;
        s_reconnect_status = MQTT_MANAGER_RECONNECT_IDLE;
        return err;
    }

    esp_mqtt_client_destroy(s_client);
    s_client = NULL;
    s_connected = false;
    s_reconnect_status = MQTT_MANAGER_RECONNECT_IDLE;
    return ESP_OK;
}

esp_err_t mqtt_manager_reconnect_async(void)
{
    if (s_client == NULL || s_mqtt_events == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    if (s_connected) {
        s_reconnect_status = MQTT_MANAGER_RECONNECT_CONNECTED;
        return ESP_OK;
    }

    xEventGroupClearBits(s_mqtt_events, MQTT_CONNECTED_BIT | MQTT_FAIL_BIT);
    s_reconnect_status = MQTT_MANAGER_RECONNECT_IN_PROGRESS;

    esp_err_t err = esp_mqtt_client_reconnect(s_client);
    if (err != ESP_OK) {
        s_reconnect_status = MQTT_MANAGER_RECONNECT_FAILED;
    }

    return err;
}

mqtt_manager_reconnect_status_t mqtt_manager_get_reconnect_status(void)
{
    return s_reconnect_status;
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
    build_topic_for_suffix(s_device_id, RESQ_SUFFIX_STATUS, topic, sizeof(topic));

    cJSON *root = cJSON_CreateObject();
    if (!root) return ESP_ERR_NO_MEM;
    cJSON_AddNumberToObject(root, "event_id", 1001);
    cJSON_AddStringToObject(root, "device_id", select_device_id_runtime());
    cJSON_AddStringToObject(root, "state", resq_state_to_string(state));
    cJSON_AddBoolToObject(root, "session_active", session_active);
    cJSON_AddStringToObject(root, "session_id", session_id ? session_id : "");

    bool calibrated = (calibration_config && calibration_config->calibrated);
    cJSON_AddBoolToObject(root, "calibrated", calibrated);

    if (calibration_config) {
        if (calibration_config->profile_id[0] != '\0') {
            cJSON_AddStringToObject(root, "profile_id", calibration_config->profile_id);
        }
        cJSON_AddNumberToObject(root, "hall_range_raw", calibration_config->hall_range_raw);
        cJSON_AddNumberToObject(root, "pressure_contact_threshold", calibration_config->pressure_contact_threshold);
        cJSON_AddNumberToObject(root, "pressure_valid_threshold", calibration_config->pressure_valid_threshold);
        cJSON_AddStringToObject(root, "pressure_mode", calibration_pressure_mode_to_string(calibration_config->pressure_mode));
        cJSON_AddBoolToObject(root, "pressure_degraded", calibration_config->pressure_degraded);
        cJSON_AddBoolToObject(root, "using_last_stable_pressure", calibration_config->using_last_stable_pressure);
        cJSON_AddBoolToObject(root, "pressure_valid", calibration_config->pressure_valid);
        cJSON_AddBoolToObject(root, "hall_valid", calibration_config->hall_valid);
        add_conversion_readiness_fields(root, calibration_config);
        cJSON_AddBoolToObject(root, "ready_for_session", calibrated && calibration_hall_mm_ready(calibration_config));
    }

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

esp_err_t mqtt_manager_publish_error_status(resq_state_t state,
                                            const network_config_t *network_config,
                                            const calibration_config_t *calibration_config,
                                            bool session_active,
                                            const char *session_id,
                                            const char *ip,
                                            int last_error_id)
{
    if (!s_connected || network_config == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    char topic[MQTT_MANAGER_TOPIC_MAX_LEN];
    build_topic_for_suffix(s_device_id, RESQ_SUFFIX_STATUS, topic, sizeof(topic));

    cJSON *root = cJSON_CreateObject();
    if (!root) return ESP_ERR_NO_MEM;

    cJSON_AddStringToObject(root, "device_id", select_device_id_runtime());
    cJSON_AddStringToObject(root, "state", resq_state_to_string(state));
    cJSON_AddBoolToObject(root, "session_active", session_active);
    cJSON_AddStringToObject(root, "session_id", session_id ? session_id : "");

    bool calibrated = (calibration_config && calibration_config->calibrated);
    cJSON_AddBoolToObject(root, "calibrated", calibrated);
    if (calibration_config) {
        cJSON_AddStringToObject(root, "pressure_mode", calibration_pressure_mode_to_string(calibration_config->pressure_mode));
        cJSON_AddBoolToObject(root, "pressure_degraded", calibration_config->pressure_degraded);
        cJSON_AddBoolToObject(root, "using_last_stable_pressure", calibration_config->using_last_stable_pressure);
        cJSON_AddBoolToObject(root, "pressure_valid", calibration_config->pressure_valid);
        cJSON_AddBoolToObject(root, "hall_valid", calibration_config->hall_valid);
        add_conversion_readiness_fields(root, calibration_config);
        cJSON_AddBoolToObject(root, "ready_for_session", calibrated && calibration_hall_mm_ready(calibration_config));
    }

    cJSON_AddNumberToObject(root, "last_error_id", last_error_id);

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
    build_topic_for_suffix(s_device_id, RESQ_SUFFIX_EVENTS, topic, sizeof(topic));

    cJSON *root = cJSON_CreateObject();
    if (!root) return ESP_ERR_NO_MEM;

    cJSON_AddStringToObject(root, "device_id", select_device_id_runtime());
    char mac[RESQ_DEVICE_MAC_MAX_LEN] = {0};
    if (config_store_get_device_mac(mac, sizeof(mac)) == ESP_OK) {
        cJSON_AddStringToObject(root, "device_mac", mac);
    } else {
        cJSON_AddStringToObject(root, "device_mac", "");
    }
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
    build_topic_for_suffix(s_device_id, RESQ_SUFFIX_HEARTBEAT, topic, sizeof(topic));

    cJSON *root = cJSON_CreateObject();
    if (!root) return ESP_ERR_NO_MEM;

    cJSON_AddStringToObject(root, "device_id", select_device_id_runtime());
    cJSON_AddStringToObject(root, "state", resq_state_to_string(state));

    bool wifi_connected = (ip && ip[0] != '\0');
    cJSON_AddBoolToObject(root, "wifi_connected", wifi_connected);
    cJSON_AddBoolToObject(root, "mqtt_connected", s_connected);

    bool backend_registered = (s_device_id[0] != '\0');
    cJSON_AddBoolToObject(root, "backend_registered", backend_registered);

    cJSON_AddBoolToObject(root, "session_active", session_active);
    cJSON_AddBoolToObject(root, "sensor_running", sensor_running);
    cJSON_AddStringToObject(root, "session_id", session_id ? session_id : "");

    bool calibrated = (calibration_config && calibration_config->calibrated);
    cJSON_AddBoolToObject(root, "calibrated", calibrated);
    if (calibration_config) {
        cJSON_AddStringToObject(root, "pressure_mode", calibration_pressure_mode_to_string(calibration_config->pressure_mode));
        cJSON_AddBoolToObject(root, "pressure_degraded", calibration_config->pressure_degraded);
        cJSON_AddBoolToObject(root, "using_last_stable_pressure", calibration_config->using_last_stable_pressure);
        cJSON_AddBoolToObject(root, "pressure_valid", calibration_config->pressure_valid);
        cJSON_AddBoolToObject(root, "hall_valid", calibration_config->hall_valid);
        add_conversion_readiness_fields(root, calibration_config);
        cJSON_AddBoolToObject(root, "ready_for_session", calibrated && calibration_hall_mm_ready(calibration_config));
    }

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
    build_topic_for_suffix(s_device_id, RESQ_SUFFIX_EVENTS, topic, sizeof(topic));
    return publish_to_topic(topic, json_payload, 1, 0);
}

esp_err_t mqtt_manager_publish_telemetry_json(const char *json_payload)
{
    if (!s_connected || json_payload == NULL) return ESP_ERR_INVALID_STATE;

    char topic[MQTT_MANAGER_TOPIC_MAX_LEN];
    build_topic_for_suffix(s_device_id, RESQ_SUFFIX_TELEMETRY, topic, sizeof(topic));
    return publish_to_topic(topic, json_payload, 0, 0);
}

esp_err_t mqtt_manager_publish_debug_json(const char *json_payload)
{
    if (!s_connected || json_payload == NULL) return ESP_ERR_INVALID_STATE;

    char topic[MQTT_MANAGER_TOPIC_MAX_LEN];
    build_topic_for_suffix(s_device_id, RESQ_SUFFIX_DEBUG, topic, sizeof(topic));
    return publish_to_topic(topic, json_payload, 0, 0);
}

esp_err_t mqtt_manager_publish_topic_json(const char *suffix,
                                          const char *json_payload)
{
    if (suffix == NULL || json_payload == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (!s_connected) {
        return ESP_ERR_INVALID_STATE;
    }

    char topic[MQTT_MANAGER_TOPIC_MAX_LEN];
    build_topic_for_suffix(s_device_id, suffix, topic, sizeof(topic));

    return publish_to_topic(topic, json_payload, 1, 0);
}

esp_err_t mqtt_manager_wait_for_command(resq_mqtt_command_t *command,
                                        TickType_t timeout_ticks)
{
    if (command == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (s_command_queue == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    BaseType_t ok = xQueueReceive(s_command_queue,
                                  command,
                                  timeout_ticks);

    if (ok == pdTRUE) {
        ESP_LOGI(TAG, "Dequeued MQTT command topic=%s payload=%s",
                 command->topic,
                 command->payload);
        return ESP_OK;
    }

    return ESP_ERR_TIMEOUT;
}
