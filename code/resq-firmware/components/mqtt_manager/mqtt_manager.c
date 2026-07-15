#include "mqtt_manager.h"

#include <stdint.h>
#include <stdatomic.h>
#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "config_store.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "io_mode_manager.h"
#include "mqtt_client.h"
#include "runtime_identity.h"

static const char *TAG = "mqtt_manager";

static void add_io_mode_fields(cJSON *root)
{
  bool pressure_enabled = io_mode_manager_is_sensor();
  cJSON_AddStringToObject(root, "io_mode",
                         io_mode_to_string(io_mode_manager_get()));
  cJSON_AddBoolToObject(root, "pressure_sensor_enabled", pressure_enabled);
}

static const char *
calibration_pressure_mode_to_string(calibration_pressure_mode_t mode) {
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

static bool
calibration_pressure_kpa_ready(const calibration_config_t *calibration) {
  return calibration != NULL && calibration->calibrated &&
         calibration->pressure_valid && !calibration->pressure_degraded &&
         calibration->pressure_0_baseline != 0 &&
         calibration->pressure_1_baseline != 0 &&
         calibration->pressure_2_baseline != 0 &&
         calibration->pressure_0_kpa_per_count > 0.0f &&
         calibration->pressure_1_kpa_per_count > 0.0f &&
         calibration->pressure_2_kpa_per_count > 0.0f;
}

static bool calibration_hall_mm_ready(const calibration_config_t *calibration) {
  return calibration != NULL && calibration->calibrated &&
         calibration->hall_valid && calibration->hall_baseline > 0 &&
         calibration->hall_range_raw > 0 && calibration->full_depth_mm > 0.0f &&
         (calibration->hall_direction == 1 ||
          calibration->hall_direction == -1);
}

static void
add_conversion_readiness_fields(cJSON *root,
                                const calibration_config_t *calibration) {
  bool pressure_ready = calibration_pressure_kpa_ready(calibration);
  bool hall_ready = calibration_hall_mm_ready(calibration);

  cJSON_AddNumberToObject(root, "full_depth_mm",
                          calibration ? calibration->full_depth_mm : 0.0f);
  cJSON_AddBoolToObject(root, "pressure_kpa_calibrated", pressure_ready);
  cJSON_AddBoolToObject(root, "hall_mm_calibrated", hall_ready);
  cJSON_AddBoolToObject(root, "pressure_kpa_valid", pressure_ready);
  cJSON_AddBoolToObject(root, "hall_mm_valid", hall_ready);
}

/* Topic model centralized in mqtt_topics.h */
#include "mqtt_topics.h"

#define MQTT_TRANSPORT_CONNECTED_BIT BIT0
#define MQTT_COMMAND_READY_BIT BIT1
#define MQTT_FAIL_BIT BIT2

static esp_mqtt_client_handle_t s_client = NULL;
static _Atomic bool s_transport_connected = false;
static bool s_connected = false;
static _Atomic mqtt_manager_reconnect_status_t s_reconnect_status =
    MQTT_MANAGER_RECONNECT_IDLE;
static EventGroupHandle_t s_mqtt_events = NULL;
static QueueHandle_t s_command_queue = NULL;
static QueueHandle_t s_safety_command_queue = NULL;
static uint32_t s_dropped_command_count = 0;
static SemaphoreHandle_t s_command_cache_mutex = NULL;

#define MQTT_COMMAND_CACHE_LEN 8
#define MQTT_COMMAND_REQUEST_ID_MAX_LEN 128
#define MQTT_COMMAND_RESPONSE_MAX_LEN 640
typedef struct {
  bool used;
  bool completed;
  char topic[MQTT_MANAGER_COMMAND_TOPIC_MAX_LEN];
  char request_id[MQTT_COMMAND_REQUEST_ID_MAX_LEN];
  char response_suffix[MQTT_MANAGER_TOPIC_MAX_LEN];
  char response_payload[MQTT_COMMAND_RESPONSE_MAX_LEN];
} mqtt_command_cache_entry_t;
static mqtt_command_cache_entry_t s_command_cache[MQTT_COMMAND_CACHE_LEN];
static size_t s_command_cache_next = 0;

static char s_device_id[RESQ_DEVICE_ID_MAX_LEN + 1] = {0};
static char s_topic_cmd_wildcard[MQTT_MANAGER_TOPIC_MAX_LEN];
static char s_lwt_topic[MQTT_MANAGER_TOPIC_MAX_LEN];
static char s_lwt_payload[192];

static esp_err_t publish_queue_overload_nack(const char *payload);
static const char *select_device_id_runtime(void);

static void mqtt_connected_store(bool connected) {
  __atomic_store_n(&s_connected, connected, __ATOMIC_RELEASE);
}

static bool mqtt_connected_load(void) {
  return __atomic_load_n(&s_connected, __ATOMIC_ACQUIRE);
}

static bool command_is_safety_critical(const char *topic) {
  return topic != NULL &&
         (strstr(topic, "/cmd/system/") != NULL ||
          strstr(topic, "/cmd/reset") != NULL ||
          strstr(topic, "/cmd/turn-off") != NULL ||
          strstr(topic, "/cmd/calibration/cancel") != NULL ||
          strstr(topic, "/cmd/session/stop") != NULL);
}

static bool extract_command_request_id(const char *payload, char *out,
                                       size_t out_len) {
  if (payload == NULL || out == NULL || out_len == 0) return false;
  cJSON *root = cJSON_Parse(payload);
  if (root == NULL) return false;
  cJSON *id = cJSON_GetObjectItemCaseSensitive(root, "request_id");
  if (!cJSON_IsString(id) || id->valuestring == NULL ||
      id->valuestring[0] == '\0') {
    id = cJSON_GetObjectItemCaseSensitive(root, "command_id");
  }
  bool valid = cJSON_IsString(id) && id->valuestring != NULL &&
               id->valuestring[0] != '\0' &&
               strnlen(id->valuestring, out_len) < out_len;
  if (valid) memcpy(out, id->valuestring, strlen(id->valuestring) + 1);
  cJSON_Delete(root);
  return valid;
}

typedef enum {
  COMMAND_CACHE_NEW = 0,
  COMMAND_CACHE_DUPLICATE_PENDING,
  COMMAND_CACHE_DUPLICATE_COMPLETE,
} command_cache_result_t;

static command_cache_result_t command_cache_check_or_mark(
    const char *topic, const char *request_id, char *out_suffix,
    size_t out_suffix_len, char *out_payload, size_t out_payload_len) {
  if (s_command_cache_mutex == NULL ||
      xSemaphoreTake(s_command_cache_mutex, pdMS_TO_TICKS(50)) != pdTRUE) {
    return COMMAND_CACHE_NEW;
  }

  for (size_t i = 0; i < MQTT_COMMAND_CACHE_LEN; ++i) {
    mqtt_command_cache_entry_t *entry = &s_command_cache[i];
    if (entry->used && strcmp(entry->topic, topic) == 0 &&
        strcmp(entry->request_id, request_id) == 0) {
      command_cache_result_t result = entry->completed
                                          ? COMMAND_CACHE_DUPLICATE_COMPLETE
                                          : COMMAND_CACHE_DUPLICATE_PENDING;
      if (entry->completed) {
        snprintf(out_suffix, out_suffix_len, "%s", entry->response_suffix);
        snprintf(out_payload, out_payload_len, "%s", entry->response_payload);
      }
      xSemaphoreGive(s_command_cache_mutex);
      return result;
    }
  }

  mqtt_command_cache_entry_t *entry =
      &s_command_cache[s_command_cache_next++ % MQTT_COMMAND_CACHE_LEN];
  memset(entry, 0, sizeof(*entry));
  entry->used = true;
  snprintf(entry->topic, sizeof(entry->topic), "%s", topic);
  snprintf(entry->request_id, sizeof(entry->request_id), "%s", request_id);
  xSemaphoreGive(s_command_cache_mutex);
  return COMMAND_CACHE_NEW;
}

static void command_cache_remove_pending(const char *topic,
                                         const char *request_id) {
  if (request_id == NULL || request_id[0] == '\0' ||
      s_command_cache_mutex == NULL ||
      xSemaphoreTake(s_command_cache_mutex, pdMS_TO_TICKS(50)) != pdTRUE) {
    return;
  }
  for (size_t i = 0; i < MQTT_COMMAND_CACHE_LEN; ++i) {
    mqtt_command_cache_entry_t *entry = &s_command_cache[i];
    if (entry->used && !entry->completed && strcmp(entry->topic, topic) == 0 &&
        strcmp(entry->request_id, request_id) == 0) {
      memset(entry, 0, sizeof(*entry));
      break;
    }
  }
  xSemaphoreGive(s_command_cache_mutex);
}

static struct {
  bool active;
  char topic[MQTT_MANAGER_COMMAND_TOPIC_MAX_LEN];
  char payload[MQTT_MANAGER_COMMAND_PAYLOAD_MAX_LEN];
  int total_len;
  int received_len;
} s_command_rx;

static void reset_command_rx(void) {
  memset(&s_command_rx, 0, sizeof(s_command_rx));
}

static esp_err_t enqueue_complete_command(const char *topic,
                                          const char *payload,
                                          int payload_len) {
  if (topic == NULL || payload == NULL || payload_len < 0) {
    return ESP_ERR_INVALID_ARG;
  }

  if (strstr(topic, "/cmd/") == NULL) {
    return ESP_OK;
  }

  if (s_command_queue == NULL) {
    ESP_LOGW(TAG, "Command queue not initialized. Command dropped.");
    return ESP_ERR_INVALID_STATE;
  }

  resq_mqtt_command_t command = {0};
  snprintf(command.topic, sizeof(command.topic), "%s", topic);
  memcpy(command.payload, payload, payload_len);
  command.payload[payload_len] = '\0';
  command.payload_len = payload_len;

  ESP_LOGI(TAG, "MQTT command received topic=%s payload_len=%d", command.topic,
           command.payload_len);

  char request_id[MQTT_COMMAND_REQUEST_ID_MAX_LEN] = {0};
  if (extract_command_request_id(payload, request_id, sizeof(request_id))) {
    char cached_suffix[MQTT_MANAGER_TOPIC_MAX_LEN] = {0};
    char cached_payload[MQTT_COMMAND_RESPONSE_MAX_LEN] = {0};
    command_cache_result_t cache_result = command_cache_check_or_mark(
        topic, request_id, cached_suffix, sizeof(cached_suffix), cached_payload,
        sizeof(cached_payload));
    if (cache_result == COMMAND_CACHE_DUPLICATE_COMPLETE) {
      ESP_LOGI(TAG, "Replaying cached response for request_id=%s", request_id);
      return mqtt_manager_publish_topic_json(cached_suffix, cached_payload);
    }
    if (cache_result == COMMAND_CACHE_DUPLICATE_PENDING) {
      ESP_LOGI(TAG, "Ignoring in-flight duplicate request_id=%s", request_id);
      return ESP_OK;
    }
  }

  QueueHandle_t target_queue = command_is_safety_critical(topic)
                                   ? s_safety_command_queue
                                   : s_command_queue;
  if (target_queue == NULL) {
    command_cache_remove_pending(topic, request_id);
    return ESP_ERR_INVALID_STATE;
  }

  BaseType_t ok = xQueueSend(target_queue, &command, 0);
  if (ok != pdTRUE) {
    __atomic_add_fetch(&s_dropped_command_count, 1u, __ATOMIC_RELAXED);
    ESP_LOGW(TAG, "MQTT command queue full. Publishing overload NACK.");
    (void)publish_queue_overload_nack(payload);
    command_cache_remove_pending(topic, request_id);
    return ESP_ERR_NO_MEM;
  }

  return ESP_OK;
}

void mqtt_manager_reset_command_reassembly_for_test(void) {
  reset_command_rx();

  if (s_command_queue != NULL) {
    resq_mqtt_command_t dropped = {0};
    while (xQueueReceive(s_command_queue, &dropped, 0) == pdTRUE) {
    }
  }
  if (s_safety_command_queue != NULL) {
    resq_mqtt_command_t dropped = {0};
    while (xQueueReceive(s_safety_command_queue, &dropped, 0) == pdTRUE) {
    }
  }
}

esp_err_t mqtt_manager_handle_command_fragment_for_test(
    const char *topic, int topic_len, const char *data, int data_len,
    int total_data_len, int current_offset) {
  int total_len = total_data_len > 0 ? total_data_len : data_len;
  int offset = current_offset;
  int fragment_len = data_len;

  if (total_len < 0 || fragment_len < 0 || offset < 0 ||
      total_len >= MQTT_MANAGER_COMMAND_PAYLOAD_MAX_LEN || offset > total_len ||
      fragment_len > total_len - offset || (fragment_len > 0 && data == NULL)) {
    ESP_LOGW(TAG,
             "Invalid or oversized MQTT payload fragment total=%d offset=%d "
             "len=%d",
             total_len, offset, fragment_len);
    reset_command_rx();
    return ESP_ERR_INVALID_ARG;
  }

  char topic_copy[MQTT_MANAGER_COMMAND_TOPIC_MAX_LEN] = {0};
  bool topic_present = topic_len > 0;
  if (topic_present) {
    if (topic == NULL || topic_len >= MQTT_MANAGER_COMMAND_TOPIC_MAX_LEN) {
      ESP_LOGW(TAG, "MQTT topic too long. Command dropped.");
      reset_command_rx();
      return ESP_ERR_INVALID_ARG;
    }
    memcpy(topic_copy, topic, topic_len);
    topic_copy[topic_len] = '\0';
  }

  if (offset == 0) {
    reset_command_rx();

    if (!topic_present) {
      ESP_LOGW(TAG, "Dropping MQTT first fragment with empty topic");
      return ESP_ERR_INVALID_ARG;
    }

    if (strstr(topic_copy, "/cmd/") == NULL) {
      return ESP_OK;
    }

    s_command_rx.active = true;
    snprintf(s_command_rx.topic, sizeof(s_command_rx.topic), "%s", topic_copy);
    s_command_rx.total_len = total_len;
  } else {
    if (!s_command_rx.active || s_command_rx.total_len != total_len ||
        s_command_rx.received_len != offset ||
        (topic_present && strcmp(s_command_rx.topic, topic_copy) != 0)) {
      ESP_LOGW(TAG,
               "Malformed MQTT payload fragment sequence topic=%s total=%d "
               "offset=%d expected=%d",
               topic_present ? topic_copy : s_command_rx.topic, total_len,
               offset, s_command_rx.received_len);
      reset_command_rx();
      return ESP_ERR_INVALID_STATE;
    }
  }

  if (fragment_len > 0) {
    memcpy(&s_command_rx.payload[offset], data, fragment_len);
  }
  s_command_rx.received_len = offset + fragment_len;

  if (s_command_rx.received_len < s_command_rx.total_len) {
    return ESP_OK;
  }

  s_command_rx.payload[s_command_rx.total_len] = '\0';
  esp_err_t err = enqueue_complete_command(
      s_command_rx.topic, s_command_rx.payload, s_command_rx.total_len);
  reset_command_rx();

  return err;
}

static esp_err_t publish_to_topic(const char *topic, const char *payload,
                                  int qos, int retain) {
  if (s_client == NULL || !mqtt_connected_load() || topic == NULL ||
      payload == NULL) {
    return ESP_ERR_INVALID_STATE;
  }

  int msg_id =
      esp_mqtt_client_publish(s_client, topic, payload, 0, qos, retain);
  if (msg_id < 0) {
    ESP_LOGE(TAG, "publish failed: %s", topic);
    return ESP_FAIL;
  }

  return ESP_OK;
}

static bool is_state_bearing_suffix(const char *suffix) {
  return suffix != NULL &&
         (strcmp(suffix, RESQ_SUFFIX_STATUS) == 0 ||
          strcmp(suffix, RESQ_SUFFIX_HEARTBEAT) == 0 ||
          strcmp(suffix, RESQ_SUFFIX_EVENTS) == 0 ||
          strcmp(suffix, RESQ_SUFFIX_EVENTS_CALIBRATION) == 0 ||
          strcmp(suffix, RESQ_SUFFIX_EVENTS_ERROR) == 0);
}

static esp_err_t publish_state_json_to_topic(const char *topic,
                                             const char *json_payload, int qos,
                                             int retain) {
  char *ordered_payload = NULL;
  esp_err_t err =
      runtime_identity_ensure_json_payload(json_payload, &ordered_payload);
  if (err != ESP_OK) {
    return err;
  }
  err = publish_to_topic(topic, ordered_payload, qos, retain);
  cJSON_free(ordered_payload);
  return err;
}

static esp_err_t publish_queue_overload_nack(const char *payload) {
  if (!mqtt_connected_load() || payload == NULL) {
    return ESP_ERR_INVALID_STATE;
  }

  cJSON *command = cJSON_Parse(payload);
  if (command == NULL) {
    return ESP_ERR_INVALID_ARG;
  }
  cJSON *request_id =
      cJSON_GetObjectItemCaseSensitive(command, "request_id");
  if (!cJSON_IsString(request_id) || request_id->valuestring == NULL ||
      request_id->valuestring[0] == '\0') {
    request_id = cJSON_GetObjectItemCaseSensitive(command, "command_id");
  }
  if (!cJSON_IsString(request_id) || request_id->valuestring == NULL ||
      request_id->valuestring[0] == '\0') {
    cJSON_Delete(command);
    return ESP_ERR_NOT_FOUND;
  }

  cJSON *reply = cJSON_CreateObject();
  if (reply == NULL) {
    cJSON_Delete(command);
    return ESP_ERR_NO_MEM;
  }
  cJSON_AddNumberToObject(reply, "event_id", 1000);
  cJSON_AddStringToObject(reply, "reply_id", request_id->valuestring);
  cJSON_AddStringToObject(reply, "status", "NACK");
  cJSON_AddStringToObject(reply, "reason", "command_queue_overloaded");
  cJSON_AddNumberToObject(reply, "dropped_command_count",
                          mqtt_manager_get_dropped_command_count());
  char *reply_payload = cJSON_PrintUnformatted(reply);
  cJSON_Delete(reply);
  cJSON_Delete(command);
  if (reply_payload == NULL) {
    return ESP_ERR_NO_MEM;
  }

  char topic[MQTT_MANAGER_TOPIC_MAX_LEN] = {0};
  esp_err_t err = resq_mqtt_build_topic(
      select_device_id_runtime(), RESQ_SUFFIX_EVENTS, topic, sizeof(topic));
  if (err == ESP_OK) {
    err = publish_state_json_to_topic(topic, reply_payload, 1, 0);
  }
  cJSON_free(reply_payload);
  return err;
}

static const char *select_device_id_runtime(void) {
  if (s_device_id[0] != '\0') {
    return s_device_id;
  }

  /* Fall back to hardware MAC if device_id not set */
  static char macbuf[RESQ_DEVICE_MAC_MAX_LEN] = {0};
  if (config_store_get_device_mac(macbuf, sizeof(macbuf)) == ESP_OK &&
      macbuf[0] != '\0') {
    return macbuf;
  }

  return "unknown";
}

/* Wrapper to maintain existing internal usage while delegating to centralized
 * helper */
static esp_err_t build_topic_for_suffix(const char *device_id,
                                        const char *suffix, char *out,
                                        size_t out_len) {
  return resq_mqtt_build_topic(device_id, suffix, out, out_len);
}

/* Implementation of centralized topic builder declared in mqtt_topics.h */
esp_err_t resq_mqtt_build_topic(const char *device_id, const char *suffix,
                                char *out, size_t out_len) {
  if (device_id == NULL || device_id[0] == '\0' || suffix == NULL ||
      suffix[0] == '\0' || out == NULL || out_len == 0) {
    return ESP_ERR_INVALID_ARG;
  }

  int needed = snprintf(out, out_len, "%s/%s/%s", RESQ_MQTT_ROOT_TOPIC,
                        device_id, suffix);
  if (needed < 0)
    return ESP_FAIL;
  if ((size_t)needed >= out_len)
    return ESP_ERR_INVALID_SIZE;
  return ESP_OK;
}

static void mqtt_event_handler(void *handler_args, esp_event_base_t base,
                               int32_t event_id, void *event_data) {
  (void)handler_args;
  (void)base;

  esp_mqtt_event_handle_t event = event_data;

  switch ((esp_mqtt_event_id_t)event_id) {
  case MQTT_EVENT_CONNECTED: {
    s_transport_connected = true;
    mqtt_connected_store(false);
    s_reconnect_status = MQTT_MANAGER_RECONNECT_IN_PROGRESS;
    ESP_LOGI(TAG, "MQTT transport connected; subscribing to commands");

    if (s_mqtt_events) {
      xEventGroupSetBits(s_mqtt_events, MQTT_TRANSPORT_CONNECTED_BIT);
      xEventGroupClearBits(s_mqtt_events, MQTT_COMMAND_READY_BIT);
    }

    if (s_client && s_topic_cmd_wildcard[0] != '\0') {
      int msg_id = esp_mqtt_client_subscribe(s_client, s_topic_cmd_wildcard, 1);
      if (msg_id < 0) {
        ESP_LOGE(TAG, "Command subscription request failed: %s",
                 s_topic_cmd_wildcard);
        if (s_mqtt_events) xEventGroupSetBits(s_mqtt_events, MQTT_FAIL_BIT);
      } else {
        ESP_LOGI(TAG, "Command subscription requested: %s (msg_id=%d)",
                 s_topic_cmd_wildcard, msg_id);
      }
    }
    break;
  }
  case MQTT_EVENT_SUBSCRIBED:
    mqtt_connected_store(true);
    s_reconnect_status = MQTT_MANAGER_RECONNECT_CONNECTED;
    ESP_LOGI(TAG, "MQTT command channel ready");
    if (s_mqtt_events) {
      xEventGroupSetBits(s_mqtt_events, MQTT_COMMAND_READY_BIT);
    }
    break;
  case MQTT_EVENT_DISCONNECTED:
    s_transport_connected = false;
    mqtt_connected_store(false);
    s_reconnect_status = MQTT_MANAGER_RECONNECT_IN_PROGRESS;
    reset_command_rx();
    if (s_mqtt_events) {
      xEventGroupClearBits(s_mqtt_events,
                           MQTT_TRANSPORT_CONNECTED_BIT |
                               MQTT_COMMAND_READY_BIT);
    }
    ESP_LOGW(TAG, "MQTT disconnected");
    break;

  case MQTT_EVENT_DATA: {
    (void)mqtt_manager_handle_command_fragment_for_test(
        event->topic, event->topic_len, event->data, event->data_len,
        event->total_data_len, event->current_data_offset);
    break;
  }

  case MQTT_EVENT_ERROR:
    s_reconnect_status = MQTT_MANAGER_RECONNECT_FAILED;
    reset_command_rx();
    ESP_LOGE(TAG, "MQTT error");
    if (s_mqtt_events) {
      xEventGroupSetBits(s_mqtt_events, MQTT_FAIL_BIT);
    }
    break;

  default:
    break;
  }
}

esp_err_t mqtt_manager_init(void) {
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

  if (s_safety_command_queue == NULL) {
    s_safety_command_queue = xQueueCreate(MQTT_MANAGER_SAFETY_QUEUE_LEN,
                                          sizeof(resq_mqtt_command_t));
    if (s_safety_command_queue == NULL) {
      return ESP_ERR_NO_MEM;
    }
  }

  if (s_command_cache_mutex == NULL) {
    s_command_cache_mutex = xSemaphoreCreateMutex();
    if (s_command_cache_mutex == NULL) {
      return ESP_ERR_NO_MEM;
    }
  }

  s_client = NULL;
  s_transport_connected = false;
  mqtt_connected_store(false);
  s_reconnect_status = MQTT_MANAGER_RECONNECT_IDLE;
  reset_command_rx();

  return ESP_OK;
}

esp_err_t mqtt_manager_start(const char *device_id, const char *mqtt_host,
                             int mqtt_port) {
  if (device_id == NULL || device_id[0] == '\0' ||
      strnlen(device_id, sizeof(s_device_id)) >= sizeof(s_device_id) ||
      mqtt_host == NULL || mqtt_host[0] == '\0' || mqtt_port <= 0 ||
      mqtt_port > 65535) {
    return ESP_ERR_INVALID_ARG;
  }

  memcpy(s_device_id, device_id, strlen(device_id) + 1);
  if (xSemaphoreTake(s_command_cache_mutex, pdMS_TO_TICKS(200)) == pdTRUE) {
    memset(s_command_cache, 0, sizeof(s_command_cache));
    s_command_cache_next = 0;
    xSemaphoreGive(s_command_cache_mutex);
  }

  /* Build subscription wildcard topic: resq/{device}/cmd/# */
  esp_err_t topic_err = resq_mqtt_build_topic(
      s_device_id, RESQ_SUFFIX_CMD_ROOT, s_topic_cmd_wildcard,
      sizeof(s_topic_cmd_wildcard));
  if (topic_err != ESP_OK) {
    return topic_err;
  }
  topic_err = resq_mqtt_build_topic(s_device_id, RESQ_SUFFIX_STATUS,
                                    s_lwt_topic, sizeof(s_lwt_topic));
  if (topic_err != ESP_OK) {
    return topic_err;
  }
  int lwt_written = snprintf(s_lwt_payload, sizeof(s_lwt_payload),
                             "{\"device_id\":\"%s\",\"state\":\"OFFLINE\"}",
                             s_device_id);
  if (lwt_written <= 0 || lwt_written >= (int)sizeof(s_lwt_payload)) {
    return ESP_ERR_INVALID_SIZE;
  }

  char uri[MQTT_MANAGER_URI_MAX_LEN];
  int uri_written =
      snprintf(uri, sizeof(uri), "mqtt://%s:%d", mqtt_host, mqtt_port);
  if (uri_written <= 0 || uri_written >= (int)sizeof(uri)) {
    return ESP_ERR_INVALID_SIZE;
  }

  esp_mqtt_client_config_t mqtt_cfg = {
      .broker.address.uri = uri,
      .session.last_will.topic = s_lwt_topic,
      .session.last_will.msg = s_lwt_payload,
      .session.last_will.msg_len = lwt_written,
      .session.last_will.qos = 1,
      .session.last_will.retain = true,
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
    xEventGroupClearBits(s_mqtt_events, MQTT_TRANSPORT_CONNECTED_BIT |
                                            MQTT_COMMAND_READY_BIT |
                                            MQTT_FAIL_BIT);
  }
  s_reconnect_status = MQTT_MANAGER_RECONNECT_IN_PROGRESS;
  reset_command_rx();

  esp_err_t reg_err = esp_mqtt_client_register_event(s_client, ESP_EVENT_ANY_ID,
                                                     mqtt_event_handler, NULL);

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
    mqtt_connected_store(false);
    s_reconnect_status = MQTT_MANAGER_RECONNECT_FAILED;
    return err;
  }

  /* wait up to 10 seconds for connection */
  EventBits_t bits =
      xEventGroupWaitBits(s_mqtt_events,
                          MQTT_COMMAND_READY_BIT | MQTT_FAIL_BIT,
                          pdFALSE, pdFALSE, pdMS_TO_TICKS(10000));

  if (bits & MQTT_COMMAND_READY_BIT) {
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
    mqtt_connected_store(false);
    s_transport_connected = false;
    s_reconnect_status = MQTT_MANAGER_RECONNECT_FAILED;
    return ESP_FAIL;
  }

  /* Timeout */
  if (s_client != NULL) {
    esp_mqtt_client_stop(s_client);
    esp_mqtt_client_destroy(s_client);
    s_client = NULL;
  }
  mqtt_connected_store(false);
  s_transport_connected = false;
  s_reconnect_status = MQTT_MANAGER_RECONNECT_FAILED;
  return ESP_ERR_TIMEOUT;
}

esp_err_t mqtt_manager_stop(void) {
  if (s_client == NULL) {
    s_transport_connected = false;
    mqtt_connected_store(false);
    s_transport_connected = false;
    s_reconnect_status = MQTT_MANAGER_RECONNECT_IDLE;
    return ESP_OK;
  }

  esp_err_t err = esp_mqtt_client_stop(s_client);
  if (err != ESP_OK) {
    /* attempt to destroy client anyway */
    esp_mqtt_client_destroy(s_client);
    s_client = NULL;
    mqtt_connected_store(false);
    s_reconnect_status = MQTT_MANAGER_RECONNECT_IDLE;
    return err;
  }

  esp_mqtt_client_destroy(s_client);
  s_client = NULL;
  mqtt_connected_store(false);
  s_transport_connected = false;
  s_reconnect_status = MQTT_MANAGER_RECONNECT_IDLE;
  return ESP_OK;
}

esp_err_t mqtt_manager_reconnect_async(void) {
  if (s_client == NULL || s_mqtt_events == NULL) {
    return ESP_ERR_INVALID_STATE;
  }

  if (mqtt_connected_load()) {
    s_reconnect_status = MQTT_MANAGER_RECONNECT_CONNECTED;
    return ESP_OK;
  }

  xEventGroupClearBits(s_mqtt_events, MQTT_TRANSPORT_CONNECTED_BIT |
                                          MQTT_COMMAND_READY_BIT |
                                          MQTT_FAIL_BIT);
  s_reconnect_status = MQTT_MANAGER_RECONNECT_IN_PROGRESS;

  esp_err_t err = esp_mqtt_client_reconnect(s_client);
  if (err != ESP_OK) {
    s_reconnect_status = MQTT_MANAGER_RECONNECT_FAILED;
  }

  return err;
}

mqtt_manager_reconnect_status_t mqtt_manager_get_reconnect_status(void) {
  return s_reconnect_status;
}

bool mqtt_manager_is_connected(void) { return mqtt_connected_load(); }

uint32_t mqtt_manager_get_dropped_command_count(void) {
  return __atomic_load_n(&s_dropped_command_count, __ATOMIC_RELAXED);
}

const char *mqtt_manager_get_device_id(void) { return s_device_id; }

esp_err_t mqtt_manager_publish_status(
    resq_state_t state, const network_config_t *network_config,
    const calibration_config_t *calibration_config, bool session_active,
    const char *session_id, const char *ip) {
  if (!mqtt_connected_load() || network_config == NULL) {
    return ESP_ERR_INVALID_STATE;
  }

  char topic[MQTT_MANAGER_TOPIC_MAX_LEN];
  esp_err_t topic_err = build_topic_for_suffix(
      select_device_id_runtime(), RESQ_SUFFIX_STATUS, topic, sizeof(topic));
  if (topic_err != ESP_OK) return topic_err;

  cJSON *root = cJSON_CreateObject();
  if (!root)
    return ESP_ERR_NO_MEM;
  cJSON_AddNumberToObject(root, "event_id", 1001);
  cJSON_AddStringToObject(root, "device_id", select_device_id_runtime());
  cJSON_AddStringToObject(root, "state", resq_state_to_string(state));
  add_io_mode_fields(root);
  cJSON_AddBoolToObject(root, "session_active", session_active);
  cJSON_AddStringToObject(root, "session_id", session_id ? session_id : "");

  bool calibrated = io_mode_manager_is_sensor() &&
                    calibration_config && calibration_config->calibrated;
  cJSON_AddBoolToObject(root, "calibrated", calibrated);

  if (calibration_config) {
    if (calibration_config->profile_id[0] != '\0') {
      cJSON_AddStringToObject(root, "profile_id",
                              calibration_config->profile_id);
    }
    cJSON_AddNumberToObject(root, "hall_range_raw",
                            calibration_config->hall_range_raw);
    cJSON_AddNumberToObject(root, "pressure_contact_threshold",
                            calibration_config->pressure_contact_threshold);
    cJSON_AddNumberToObject(root, "pressure_valid_threshold",
                            calibration_config->pressure_valid_threshold);
    cJSON_AddStringToObject(
        root, "pressure_mode",
        calibration_pressure_mode_to_string(calibration_config->pressure_mode));
    cJSON_AddBoolToObject(root, "pressure_degraded",
                          calibration_config->pressure_degraded);
    cJSON_AddBoolToObject(root, "using_last_stable_pressure",
                          calibration_config->using_last_stable_pressure);
    cJSON_AddBoolToObject(root, "pressure_valid",
                          io_mode_manager_is_sensor() &&
                              calibration_config->pressure_valid);
    cJSON_AddBoolToObject(root, "hall_valid", calibration_config->hall_valid);
    add_conversion_readiness_fields(root, calibration_config);
    cJSON_AddBoolToObject(root, "ready_for_session",
                          calibrated &&
                              calibration_hall_mm_ready(calibration_config));
  }

  cJSON_AddStringToObject(root, "ip", ip ? ip : "");

  int64_t ts_ms = esp_timer_get_time() / 1000;
  cJSON_AddNumberToObject(root, "ts_ms", ts_ms);

  char *payload = cJSON_PrintUnformatted(root);
  cJSON_Delete(root);
  if (!payload)
    return ESP_ERR_NO_MEM;

  esp_err_t ret = publish_state_json_to_topic(topic, payload, 1, 1);
  cJSON_free(payload);
  return ret;
}

esp_err_t mqtt_manager_publish_error_status(
    resq_state_t state, const network_config_t *network_config,
    const calibration_config_t *calibration_config, bool session_active,
    const char *session_id, const char *ip, int last_error_id) {
  if (!mqtt_connected_load() || network_config == NULL) {
    return ESP_ERR_INVALID_STATE;
  }

  char topic[MQTT_MANAGER_TOPIC_MAX_LEN];
  esp_err_t topic_err = build_topic_for_suffix(
      select_device_id_runtime(), RESQ_SUFFIX_STATUS, topic, sizeof(topic));
  if (topic_err != ESP_OK) return topic_err;

  cJSON *root = cJSON_CreateObject();
  if (!root)
    return ESP_ERR_NO_MEM;

  cJSON_AddStringToObject(root, "device_id", select_device_id_runtime());
  cJSON_AddStringToObject(root, "state", resq_state_to_string(state));
  add_io_mode_fields(root);
  cJSON_AddBoolToObject(root, "session_active", session_active);
  cJSON_AddStringToObject(root, "session_id", session_id ? session_id : "");

  bool calibrated = io_mode_manager_is_sensor() &&
                    calibration_config && calibration_config->calibrated;
  cJSON_AddBoolToObject(root, "calibrated", calibrated);
  if (calibration_config) {
    cJSON_AddStringToObject(
        root, "pressure_mode",
        calibration_pressure_mode_to_string(calibration_config->pressure_mode));
    cJSON_AddBoolToObject(root, "pressure_degraded",
                          calibration_config->pressure_degraded);
    cJSON_AddBoolToObject(root, "using_last_stable_pressure",
                          calibration_config->using_last_stable_pressure);
    cJSON_AddBoolToObject(root, "pressure_valid",
                          io_mode_manager_is_sensor() &&
                              calibration_config->pressure_valid);
    cJSON_AddBoolToObject(root, "hall_valid", calibration_config->hall_valid);
    add_conversion_readiness_fields(root, calibration_config);
    cJSON_AddBoolToObject(root, "ready_for_session",
                          calibrated &&
                              calibration_hall_mm_ready(calibration_config));
  }

  if (calibration_config) {
    cJSON_AddNumberToObject(root, "calibration_schema_version",
                            calibration_config->calibration_schema_version);
    cJSON_AddNumberToObject(root, "calibration_generation",
                            calibration_config->calibration_generation);
    cJSON_AddStringToObject(root, "calibration_storage_status",
                            calibration_config->calibration_storage_status);
    cJSON_AddBoolToObject(root, "recalibration_required",
                          calibration_config->recalibration_required);
    cJSON_AddNumberToObject(root, "profile_version",
                            calibration_config->profile_version);
    cJSON_AddStringToObject(root, "profile_hash",
                            calibration_config->profile_hash);
  } else {
    cJSON_AddNumberToObject(root, "calibration_schema_version", 0);
    cJSON_AddNumberToObject(root, "calibration_generation", 0);
    cJSON_AddStringToObject(root, "calibration_storage_status", "MISSING");
    cJSON_AddBoolToObject(root, "recalibration_required", true);
    cJSON_AddNumberToObject(root, "profile_version", 0);
    cJSON_AddStringToObject(root, "profile_hash", "");
  }

  cJSON_AddNumberToObject(root, "last_error_id", last_error_id);

  cJSON_AddStringToObject(root, "ip", ip ? ip : "");

  int64_t ts_ms = esp_timer_get_time() / 1000;
  cJSON_AddNumberToObject(root, "ts_ms", ts_ms);

  char *payload = cJSON_PrintUnformatted(root);
  cJSON_Delete(root);
  if (!payload)
    return ESP_ERR_NO_MEM;

  esp_err_t ret = publish_state_json_to_topic(topic, payload, 1, 1);
  cJSON_free(payload);
  return ret;
}

esp_err_t
mqtt_manager_publish_identity_event(const network_config_t *network_config) {
  if (!mqtt_connected_load() || network_config == NULL) {
    return ESP_ERR_INVALID_STATE;
  }

  char topic[MQTT_MANAGER_TOPIC_MAX_LEN];
  esp_err_t topic_err = build_topic_for_suffix(
      select_device_id_runtime(), RESQ_SUFFIX_EVENTS, topic, sizeof(topic));
  if (topic_err != ESP_OK) return topic_err;

  cJSON *root = cJSON_CreateObject();
  if (!root)
    return ESP_ERR_NO_MEM;

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
  if (!payload)
    return ESP_ERR_NO_MEM;

  esp_err_t ret = publish_state_json_to_topic(topic, payload, 1, 0);
  cJSON_free(payload);
  return ret;
}

esp_err_t
mqtt_manager_publish_heartbeat(const network_config_t *network_config,
                               const calibration_config_t *calibration_config,
                               resq_state_t state, bool session_active,
                               bool sensor_running, const char *session_id,
                               const char *ip, int rssi) {
  if (!mqtt_connected_load() || network_config == NULL) {
    return ESP_ERR_INVALID_STATE;
  }

  char topic[MQTT_MANAGER_TOPIC_MAX_LEN];
  esp_err_t topic_err = build_topic_for_suffix(
      select_device_id_runtime(), RESQ_SUFFIX_HEARTBEAT, topic,
      sizeof(topic));
  if (topic_err != ESP_OK) return topic_err;

  cJSON *root = cJSON_CreateObject();
  if (!root)
    return ESP_ERR_NO_MEM;

  cJSON_AddStringToObject(root, "device_id", select_device_id_runtime());
  cJSON_AddStringToObject(root, "state", resq_state_to_string(state));
  add_io_mode_fields(root);

  bool wifi_connected = (ip && ip[0] != '\0');
  cJSON_AddBoolToObject(root, "wifi_connected", wifi_connected);
  cJSON_AddBoolToObject(root, "mqtt_connected", mqtt_connected_load());

  bool backend_registered = (s_device_id[0] != '\0');
  cJSON_AddBoolToObject(root, "backend_registered", backend_registered);

  cJSON_AddBoolToObject(root, "session_active", session_active);
  cJSON_AddBoolToObject(root, "sensor_running",
                        io_mode_manager_is_sensor() && sensor_running);
  cJSON_AddStringToObject(root, "session_id", session_id ? session_id : "");

  bool calibrated = io_mode_manager_is_sensor() &&
                    calibration_config && calibration_config->calibrated;
  cJSON_AddBoolToObject(root, "calibrated", calibrated);
  if (calibration_config) {
    cJSON_AddStringToObject(
        root, "pressure_mode",
        calibration_pressure_mode_to_string(calibration_config->pressure_mode));
    cJSON_AddBoolToObject(root, "pressure_degraded",
                          calibration_config->pressure_degraded);
    cJSON_AddBoolToObject(root, "using_last_stable_pressure",
                          calibration_config->using_last_stable_pressure);
    cJSON_AddBoolToObject(root, "pressure_valid",
                          io_mode_manager_is_sensor() &&
                              calibration_config->pressure_valid);
    cJSON_AddBoolToObject(root, "hall_valid", calibration_config->hall_valid);
    add_conversion_readiness_fields(root, calibration_config);
    cJSON_AddBoolToObject(root, "ready_for_session",
                          calibrated &&
                              calibration_hall_mm_ready(calibration_config));
  }

  cJSON_AddStringToObject(root, "ip", ip ? ip : "");
  cJSON_AddNumberToObject(root, "rssi", rssi);

  int64_t uptime_ms = esp_timer_get_time() / 1000;
  cJSON_AddNumberToObject(root, "uptime_ms", uptime_ms);

  int64_t ts_ms = esp_timer_get_time() / 1000;
  cJSON_AddNumberToObject(root, "ts_ms", ts_ms);

  char *payload = cJSON_PrintUnformatted(root);
  cJSON_Delete(root);
  if (!payload)
    return ESP_ERR_NO_MEM;

  esp_err_t ret = publish_state_json_to_topic(topic, payload, 0, 0);
  cJSON_free(payload);
  return ret;
}

esp_err_t mqtt_manager_publish_event_json(const char *json_payload) {
  if (!mqtt_connected_load() || json_payload == NULL)
    return ESP_ERR_INVALID_STATE;

  char topic[MQTT_MANAGER_TOPIC_MAX_LEN];
  esp_err_t topic_err = build_topic_for_suffix(
      select_device_id_runtime(), RESQ_SUFFIX_EVENTS, topic, sizeof(topic));
  if (topic_err != ESP_OK) return topic_err;
  return publish_state_json_to_topic(topic, json_payload, 1, 0);
}

esp_err_t mqtt_manager_publish_telemetry_json(const char *json_payload) {
  if (!mqtt_connected_load() || json_payload == NULL)
    return ESP_ERR_INVALID_STATE;

  char topic[MQTT_MANAGER_TOPIC_MAX_LEN];
  esp_err_t topic_err = build_topic_for_suffix(
      select_device_id_runtime(), RESQ_SUFFIX_TELEMETRY, topic,
      sizeof(topic));
  if (topic_err != ESP_OK) return topic_err;
  return publish_to_topic(topic, json_payload, 0, 0);
}

esp_err_t mqtt_manager_publish_debug_json(const char *json_payload) {
  if (!mqtt_connected_load() || json_payload == NULL)
    return ESP_ERR_INVALID_STATE;

  char topic[MQTT_MANAGER_TOPIC_MAX_LEN];
  esp_err_t topic_err = build_topic_for_suffix(
      select_device_id_runtime(), RESQ_SUFFIX_DEBUG, topic, sizeof(topic));
  if (topic_err != ESP_OK) return topic_err;
  return publish_to_topic(topic, json_payload, 0, 0);
}

esp_err_t mqtt_manager_publish_topic_json(const char *suffix,
                                          const char *json_payload) {
  if (suffix == NULL || json_payload == NULL) {
    return ESP_ERR_INVALID_ARG;
  }

  if (!mqtt_connected_load()) {
    return ESP_ERR_INVALID_STATE;
  }

  char topic[MQTT_MANAGER_TOPIC_MAX_LEN];
  esp_err_t topic_err = build_topic_for_suffix(
      select_device_id_runtime(), suffix, topic, sizeof(topic));
  if (topic_err != ESP_OK) return topic_err;

  if (is_state_bearing_suffix(suffix)) {
    return publish_state_json_to_topic(topic, json_payload, 1, 0);
  }

  return publish_to_topic(topic, json_payload, 1, 0);
}

esp_err_t mqtt_manager_cache_command_response(const char *command_topic,
                                               const char *request_id,
                                               const char *response_suffix,
                                               const char *response_payload) {
  if (command_topic == NULL || request_id == NULL || request_id[0] == '\0' ||
      response_suffix == NULL || response_payload == NULL ||
      strnlen(command_topic, MQTT_MANAGER_COMMAND_TOPIC_MAX_LEN) >=
          MQTT_MANAGER_COMMAND_TOPIC_MAX_LEN ||
      strnlen(request_id, MQTT_COMMAND_REQUEST_ID_MAX_LEN) >=
          MQTT_COMMAND_REQUEST_ID_MAX_LEN ||
      strnlen(response_suffix, MQTT_MANAGER_TOPIC_MAX_LEN) >=
          MQTT_MANAGER_TOPIC_MAX_LEN ||
      strnlen(response_payload, MQTT_COMMAND_RESPONSE_MAX_LEN) >=
          MQTT_COMMAND_RESPONSE_MAX_LEN) {
    return ESP_ERR_INVALID_ARG;
  }

  char *ordered_payload = NULL;
  if (is_state_bearing_suffix(response_suffix)) {
    esp_err_t identity_err =
        runtime_identity_ensure_json_payload(response_payload, &ordered_payload);
    if (identity_err != ESP_OK) {
      return identity_err;
    }
    if (strnlen(ordered_payload, MQTT_COMMAND_RESPONSE_MAX_LEN) >=
        MQTT_COMMAND_RESPONSE_MAX_LEN) {
      cJSON_free(ordered_payload);
      return ESP_ERR_INVALID_ARG;
    }
  }
  const char *payload_to_cache =
      ordered_payload != NULL ? ordered_payload : response_payload;

  if (s_command_cache_mutex == NULL ||
      xSemaphoreTake(s_command_cache_mutex, pdMS_TO_TICKS(200)) != pdTRUE) {
    if (ordered_payload != NULL) cJSON_free(ordered_payload);
    return ESP_ERR_TIMEOUT;
  }

  mqtt_command_cache_entry_t *target = NULL;
  for (size_t i = 0; i < MQTT_COMMAND_CACHE_LEN; ++i) {
    if (s_command_cache[i].used &&
        strcmp(s_command_cache[i].topic, command_topic) == 0 &&
        strcmp(s_command_cache[i].request_id, request_id) == 0) {
      target = &s_command_cache[i];
      break;
    }
  }
  if (target == NULL) {
    target = &s_command_cache[s_command_cache_next++ % MQTT_COMMAND_CACHE_LEN];
    memset(target, 0, sizeof(*target));
    target->used = true;
    memcpy(target->topic, command_topic, strlen(command_topic) + 1);
    memcpy(target->request_id, request_id, strlen(request_id) + 1);
  }
  memcpy(target->response_suffix, response_suffix,
         strlen(response_suffix) + 1);
  memcpy(target->response_payload, payload_to_cache,
         strlen(payload_to_cache) + 1);
  target->completed = true;
  xSemaphoreGive(s_command_cache_mutex);
  if (ordered_payload != NULL) cJSON_free(ordered_payload);
  return ESP_OK;
}

esp_err_t mqtt_manager_wait_for_command(resq_mqtt_command_t *command,
                                        TickType_t timeout_ticks) {
  if (command == NULL) {
    return ESP_ERR_INVALID_ARG;
  }

  if (s_command_queue == NULL || s_safety_command_queue == NULL) {
    return ESP_ERR_INVALID_STATE;
  }

  TickType_t start = xTaskGetTickCount();
  do {
    BaseType_t ok = xQueueReceive(s_safety_command_queue, command, 0);
    if (ok != pdTRUE) {
      ok = xQueueReceive(s_command_queue, command, 0);
    }

    if (ok == pdTRUE) {
      ESP_LOGI(TAG, "Dequeued MQTT command topic=%s payload=%s",
               command->topic, command->payload);
      return ESP_OK;
    }

    if (timeout_ticks == 0) break;
    vTaskDelay(1);
  } while (timeout_ticks == portMAX_DELAY ||
           (xTaskGetTickCount() - start) < timeout_ticks);

  return ESP_ERR_TIMEOUT;
}
