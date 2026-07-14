#include "session_active_manager.h"

#include <stdio.h>
#include <string.h>

#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include "cJSON.h"

#include "board_config.h"
#include "buzzer_manager.h"
#include "calibration_manager.h"
#include "cpr_metrics.h"
#include "error_manager.h"
#include "hall_sensor.h"
#include "hx710.h"
#include "mqtt_manager.h"
#include "runtime_helpers.h"
#include "sensor_owner.h"
#include "session_manager.h"
#include "system_button_manager.h"
#include "telemetry_publisher.h"
#include "wifi_manager.h"

static const char *TAG = "session_active_mgr";

static TaskHandle_t s_sensor_task = NULL;
static volatile bool s_sensor_task_run = false;
static SemaphoreHandle_t s_mutex = NULL;
static EventGroupHandle_t s_sensor_task_events = NULL;

#define SENSOR_TASK_STARTED_BIT BIT0
#define SENSOR_TASK_STOPPED_BIT BIT1
#define SENSOR_TASK_FAILED_BIT BIT2
#define SENSOR_TASK_START_TIMEOUT_MS 1500
#define SENSOR_TASK_STOP_TIMEOUT_MS 3000

#define CONNECTIVITY_RECOVERY_TIMEOUT_MS 30000
#define CONNECTIVITY_RETRY_INTERVAL_MS 3000
#define CONNECTIVITY_POLL_INTERVAL_MS 100

typedef struct {
  bool pending;
  bool event_published;
  char session_id[RESQ_SESSION_ID_MAX_LEN];
  cpr_metrics_snapshot_t metrics;
  int64_t interrupted_at_ms;
} pending_interruption_t;

static pending_interruption_t s_pending_interruption;
static esp_err_t session_sensor_task_stop(void);

static void sensor_task_finish(bool failed) {
  sensor_owner_release(SENSOR_OWNER_SESSION);

  xSemaphoreTake(s_mutex, portMAX_DELAY);
  s_sensor_task_run = false;
  s_sensor_task = NULL;
  xSemaphoreGive(s_mutex);

  EventBits_t bits = SENSOR_TASK_STOPPED_BIT;
  if (failed) {
    bits |= SENSOR_TASK_FAILED_BIT;
  }
  xEventGroupSetBits(s_sensor_task_events, bits);
}

static void session_sensor_task(void *arg) {
  (void)arg;

  hall_sensor_t local_hall = {0};
  if (hall_sensor_init(&local_hall, BOARD_HALL_ADC_CHAN) != ESP_OK) {
    ESP_LOGE(TAG, "hall_sensor_init failed");
    sensor_task_finish(true);
    vTaskDelete(NULL);
    return;
  }

  if (hx710_init(BOARD_HX710_SHARED_SCK, BOARD_HX710_0_DOUT) != ESP_OK ||
      hx710_init(BOARD_HX710_SHARED_SCK, BOARD_HX710_1_DOUT) != ESP_OK ||
      hx710_init(BOARD_HX710_SHARED_SCK, BOARD_HX710_2_DOUT) != ESP_OK) {
    ESP_LOGE(TAG, "HX710 sensor initialization failed");
    sensor_task_finish(true);
    vTaskDelete(NULL);
    return;
  }

  xEventGroupSetBits(s_sensor_task_events, SENSOR_TASK_STARTED_BIT);

  while (s_sensor_task_run) {
    cpr_sensor_sample_t sample = {0};
    sample.ts_ms = esp_timer_get_time() / 1000;

    {
      int32_t p0 = 0, p1 = 0, p2 = 0;
      uint8_t valid_mask = 0;
      esp_err_t pressure_err = hx710_read_3_shared_sck_valid(
          BOARD_HX710_SHARED_SCK, BOARD_HX710_0_DOUT, BOARD_HX710_1_DOUT,
          BOARD_HX710_2_DOUT, &p0, &p1, &p2, &valid_mask);

      sample.pressure_0_raw = p0;
      sample.pressure_1_raw = p1;
      sample.pressure_2_raw = p2;
      if ((valid_mask & HX710_VALID_CHANNEL_0) == 0)
        sample.quality_flags |= CPR_SAMPLE_PRESSURE_0_READ_FAILED;
      if ((valid_mask & HX710_VALID_CHANNEL_1) == 0)
        sample.quality_flags |= CPR_SAMPLE_PRESSURE_1_READ_FAILED;
      if ((valid_mask & HX710_VALID_CHANNEL_2) == 0)
        sample.quality_flags |= CPR_SAMPLE_PRESSURE_2_READ_FAILED;
      if (pressure_err != ESP_OK || valid_mask != HX710_VALID_CHANNEL_ALL) {
        ESP_LOGW(TAG, "HX710 read partial: err=%s valid_mask=0x%02x",
                 esp_err_to_name(pressure_err), valid_mask);
      }
    }

    int hall_raw = 0;
    if (hall_sensor_read_raw(&local_hall, &hall_raw) == ESP_OK) {
      sample.hall_raw = hall_raw;
    } else {
      sample.quality_flags |= CPR_SAMPLE_HALL_READ_FAILED;
    }

    cpr_metrics_update(&sample);

    ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(20));
  }

  sensor_task_finish(false);
  vTaskDelete(NULL);
}

static esp_err_t session_sensor_task_start(void) {
  if (s_mutex == NULL || s_sensor_task_events == NULL) {
    return ESP_ERR_INVALID_STATE;
  }

  if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(200)) != pdTRUE) {
    return ESP_ERR_TIMEOUT;
  }

  if (s_sensor_task != NULL) {
    esp_err_t result = s_sensor_task_run ? ESP_OK : ESP_ERR_INVALID_STATE;
    xSemaphoreGive(s_mutex);
    return result;
  }

  esp_err_t owner_err = sensor_owner_acquire(SENSOR_OWNER_SESSION);
  if (owner_err != ESP_OK) {
    xSemaphoreGive(s_mutex);
    return owner_err;
  }

  xEventGroupClearBits(s_sensor_task_events, SENSOR_TASK_STARTED_BIT |
                                                 SENSOR_TASK_STOPPED_BIT |
                                                 SENSOR_TASK_FAILED_BIT);
  s_sensor_task_run = true;

  BaseType_t ok = xTaskCreate(session_sensor_task, "session_sensor", 4096, NULL,
                              6, &s_sensor_task);

  if (ok != pdPASS) {
    s_sensor_task_run = false;
    sensor_owner_release(SENSOR_OWNER_SESSION);
    xSemaphoreGive(s_mutex);
    xEventGroupSetBits(s_sensor_task_events, SENSOR_TASK_STOPPED_BIT);
    return ESP_FAIL;
  }

  xSemaphoreGive(s_mutex);

  EventBits_t bits = xEventGroupWaitBits(
      s_sensor_task_events, SENSOR_TASK_STARTED_BIT | SENSOR_TASK_FAILED_BIT,
      pdFALSE, pdFALSE, pdMS_TO_TICKS(SENSOR_TASK_START_TIMEOUT_MS));

  if (bits & SENSOR_TASK_FAILED_BIT) {
    return ESP_FAIL;
  }

  if ((bits & SENSOR_TASK_STARTED_BIT) == 0) {
    /* The task owns cleanup once it has been created. Do not advertise the
     * sensors as free until TASK_STOPPED confirms that it has exited. */
    esp_err_t stop_err = session_sensor_task_stop();
    if (stop_err != ESP_OK) {
      ESP_LOGE(TAG,
               "Session sensor startup timed out and task cleanup did not "
               "complete; sensor ownership remains quarantined");
    }
    return ESP_ERR_TIMEOUT;
  }

  return ESP_OK;
}

static esp_err_t session_sensor_task_stop(void) {
  if (s_mutex == NULL || s_sensor_task_events == NULL) {
    return ESP_ERR_INVALID_STATE;
  }

  if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(200)) != pdTRUE) {
    return ESP_ERR_TIMEOUT;
  }

  if (s_sensor_task == NULL) {
    s_sensor_task_run = false;
    xSemaphoreGive(s_mutex);
    return ESP_OK;
  }

  s_sensor_task_run = false;
  TaskHandle_t task = s_sensor_task;
  xTaskNotifyGive(task);
  xSemaphoreGive(s_mutex);

  EventBits_t bits = xEventGroupWaitBits(
      s_sensor_task_events, SENSOR_TASK_STOPPED_BIT, pdFALSE, pdTRUE,
      pdMS_TO_TICKS(SENSOR_TASK_STOP_TIMEOUT_MS));

  return (bits & SENSOR_TASK_STOPPED_BIT) ? ESP_OK : ESP_ERR_TIMEOUT;
}

static esp_err_t stop_runtime_components(cpr_metrics_snapshot_t *out_snapshot) {
  esp_err_t first_error = ESP_OK;
  esp_err_t err = telemetry_publisher_stop_all();
  if (err != ESP_OK && first_error == ESP_OK) {
    first_error = err;
  }

  err = buzzer_manager_stop();
  if (err != ESP_OK && first_error == ESP_OK) {
    first_error = err;
  }

  err = session_sensor_task_stop();
  if (err != ESP_OK && first_error == ESP_OK) {
    first_error = err;
  }

  if (out_snapshot != NULL) {
    err = cpr_metrics_get_snapshot(out_snapshot);
    if (err != ESP_OK && first_error == ESP_OK) {
      first_error = err;
    }
  }

  return first_error;
}

static esp_err_t
publish_debug_snapshot_from_metrics(const network_config_t *network_config) {
  cpr_metrics_snapshot_t snap = {0};
  esp_err_t err = cpr_metrics_get_snapshot(&snap);
  if (err != ESP_OK) {
    return err;
  }

  char payload[1280];
  int written = snprintf(
      payload, sizeof(payload),
      "{"
      "\"device_id\":\"%s\","
      "\"source\":\"SESSION_METRICS\","
      "\"depth_progress\":%.3f,"
      "\"depth_mm\":%.3f,"
      "\"depth_ok\":%s,"
      "\"rate_cpm\":%.1f,"
      "\"hand_placement\":\"%s\","
      "\"pressure_balance_pct\":%.2f,"
      "\"pressure_balance_reliable\":%s,"
      "\"pressure_0_kpa\":%.3f,"
      "\"pressure_0_kpa_valid\":%s,"
      "\"pressure_1_kpa\":%.3f,"
      "\"pressure_1_kpa_valid\":%s,"
      "\"pressure_2_kpa\":%.3f,"
      "\"pressure_2_kpa_valid\":%s,"
      "\"pressure_kpa_valid\":%s,"
      "\"hall_mm_valid\":%s,"
      "\"pressure_saturation_mask\":%u,"
      "\"sensor_quality_flags\":%u,"
      "\"missed_pressure_samples\":%d,"
      "\"missed_hall_samples\":%d,"
      "\"flags\":\"%s\","
      "\"ts_ms\":%lld"
      "}",
      runtime_helpers_get_device_id(network_config), snap.depth_progress,
      snap.depth_mm, snap.depth_ok ? "true" : "false", snap.rate_cpm,
      snap.hand_placement, snap.pressure_balance_pct,
      snap.pressure_balance_reliable ? "true" : "false",
      snap.pressure_0_kpa_valid ? snap.pressure_0_kpa : 0.0f,
      snap.pressure_0_kpa_valid ? "true" : "false",
      snap.pressure_1_kpa_valid ? snap.pressure_1_kpa : 0.0f,
      snap.pressure_1_kpa_valid ? "true" : "false",
      snap.pressure_2_kpa_valid ? snap.pressure_2_kpa : 0.0f,
      snap.pressure_2_kpa_valid ? "true" : "false",
      snap.pressure_kpa_valid ? "true" : "false",
      snap.hall_mm_valid ? "true" : "false",
      (unsigned int)snap.pressure_saturation_mask,
      (unsigned int)snap.sensor_quality_flags, snap.missed_pressure_samples,
      snap.missed_hall_samples, snap.flags, (long long)snap.ts_ms);

  if (written <= 0 || written >= (int)sizeof(payload)) {
    return ESP_ERR_INVALID_SIZE;
  }

  if (!mqtt_manager_is_connected()) {
    return ESP_ERR_INVALID_STATE;
  }

  return mqtt_manager_publish_debug_json(payload);
}

static void
remember_terminal_interruption(const char *session_id,
                               const cpr_metrics_snapshot_t *snapshot) {
  memset(&s_pending_interruption, 0, sizeof(s_pending_interruption));
  s_pending_interruption.pending = true;
  s_pending_interruption.interrupted_at_ms = esp_timer_get_time() / 1000;

  if (session_id != NULL) {
    strncpy(s_pending_interruption.session_id, session_id,
            sizeof(s_pending_interruption.session_id) - 1);
  }

  if (snapshot != NULL) {
    memcpy(&s_pending_interruption.metrics, snapshot,
           sizeof(s_pending_interruption.metrics));
  }
}

esp_err_t session_active_manager_init(void) {
  esp_err_t owner_err = sensor_owner_init();
  if (owner_err != ESP_OK) {
    return owner_err;
  }

  bool first_init = s_mutex == NULL && s_sensor_task_events == NULL;

  if (s_mutex == NULL) {
    s_mutex = xSemaphoreCreateMutex();
    if (s_mutex == NULL)
      return ESP_ERR_NO_MEM;
  }

  if (s_sensor_task_events == NULL) {
    s_sensor_task_events = xEventGroupCreate();
    if (s_sensor_task_events == NULL)
      return ESP_ERR_NO_MEM;
  }

  if (first_init) {
    s_sensor_task_run = false;
    s_sensor_task = NULL;
    memset(&s_pending_interruption, 0, sizeof(s_pending_interruption));
    xEventGroupSetBits(s_sensor_task_events, SENSOR_TASK_STOPPED_BIT);
  }

  return ESP_OK;
}

resq_state_t session_active_manager_start(
    network_config_t *network_config, calibration_config_t *calibration_config,
    const char *ip_address, const char *session_id, const char *profile_id,
    const resq_mqtt_command_t *cmd) {
  if (network_config == NULL || calibration_config == NULL ||
      session_id == NULL) {
    return RESQ_STATE_READY_FOR_SESSION;
  }

  /* Require request_id in the originating MQTT command; do not start session
   * if request_id is missing. Publish a NACK reply if a command context was
   * provided. */
  char request_id[128] = {0};
  if (cmd == NULL ||
      resq_command_extract_request_id(cmd->payload, request_id,
                                      sizeof(request_id)) != ESP_OK) {
    if (cmd != NULL) {
      runtime_helpers_publish_command_result_from_command(
          network_config, RESQ_STATE_READY_FOR_SESSION, cmd,
          "cmd/session/start", "NACK", "missing_request_id");
    }
    return RESQ_STATE_READY_FOR_SESSION;
  }

  if (!calibration_config->calibrated || !calibration_manager_is_ready() ||
      !calibration_config_is_valid(calibration_config)) {
    if (cmd != NULL) {
      runtime_helpers_publish_command_result_from_command(
          network_config, RESQ_STATE_READY_FOR_SESSION, cmd,
          "cmd/session/start", "NACK", "calibration_not_ready");
    }
    return RESQ_STATE_READY_FOR_SESSION;
  }

  uint32_t req_version = 0;
  char req_hash[128] = {0};
  cJSON *req_root = cJSON_Parse(cmd->payload);
  if (req_root != NULL) {
    cJSON *v = cJSON_GetObjectItemCaseSensitive(req_root, "profile_version");
    if (!v) v = cJSON_GetObjectItemCaseSensitive(req_root, "profileVersion");
    if (v && cJSON_IsNumber(v)) {
      req_version = (uint32_t)v->valuedouble;
    }
    cJSON *h = cJSON_GetObjectItemCaseSensitive(req_root, "profile_hash");
    if (!h) h = cJSON_GetObjectItemCaseSensitive(req_root, "profileHash");
    if (h && cJSON_IsString(h) && h->valuestring) {
      strncpy(req_hash, h->valuestring, sizeof(req_hash) - 1);
    }
    cJSON_Delete(req_root);
  }

  if (!calibration_profile_matches(calibration_config, profile_id) ||
      calibration_config->profile_version != req_version ||
      strcmp(calibration_config->profile_hash, req_hash) != 0) {
    if (cmd != NULL) {
      runtime_helpers_publish_command_result_from_command(
          network_config, RESQ_STATE_READY_FOR_SESSION, cmd,
          "cmd/session/start", "NACK", "profile_mismatch");
    }
    return RESQ_STATE_READY_FOR_SESSION;
  }

  if (!wifi_manager_is_connected() || !mqtt_manager_is_connected()) {
    if (cmd != NULL) {
      runtime_helpers_publish_command_result_from_command(
          network_config, RESQ_STATE_READY_FOR_SESSION, cmd,
          "cmd/session/start", "NACK", "connectivity_not_ready");
    }
    return RESQ_STATE_READY_FOR_SESSION;
  }

  esp_err_t start_err =
      session_manager_start(session_id, profile_id ? profile_id : "");
  if (start_err != ESP_OK) {
    if (cmd != NULL) {
      runtime_helpers_publish_command_result_from_command(
          network_config, RESQ_STATE_READY_FOR_SESSION, cmd,
          "cmd/session/start", "NACK", "session_already_active");
    }
    return RESQ_STATE_READY_FOR_SESSION;
  }

  esp_err_t metrics_err = cpr_metrics_reset(calibration_config);
  if (metrics_err != ESP_OK) {
    ESP_LOGE(TAG, "Failed to reset CPR metrics: %s",
             esp_err_to_name(metrics_err));
    session_manager_stop(session_id);
    error_manager_set_error(FW_ERROR_SESSION_START_FAILED);
    if (cmd != NULL) {
      runtime_helpers_publish_command_result_from_command(
          network_config, RESQ_STATE_READY_FOR_SESSION, cmd,
          "cmd/session/start", "NACK", "metrics_reset_failed");
    }
    return RESQ_STATE_ERROR;
  }

  esp_err_t sensor_err = session_sensor_task_start();
  if (sensor_err != ESP_OK) {
    ESP_LOGE(TAG, "Failed to start sensor task: %s",
             esp_err_to_name(sensor_err));
    session_sensor_task_stop();
    session_manager_stop(session_id);
    error_manager_set_error(FW_ERROR_SENSOR_RUNTIME_FAILED);
    if (cmd != NULL) {
      runtime_helpers_publish_command_result_from_command(
          network_config, RESQ_STATE_READY_FOR_SESSION, cmd,
          "cmd/session/start", "NACK", "sensor_start_failed");
    }
    return RESQ_STATE_ERROR;
  }

  esp_err_t buzz_err = buzzer_manager_start_metronome(110);
  if (buzz_err != ESP_OK) {
    ESP_LOGE(TAG, "Failed to start buzzer metronome: %s",
             esp_err_to_name(buzz_err));
    error_manager_set_error(FW_ERROR_BUZZER_TASK_FAILED);
    session_sensor_task_stop();
    session_manager_stop(session_id);
    if (cmd != NULL) {
      runtime_helpers_publish_command_result_from_command(
          network_config, RESQ_STATE_READY_FOR_SESSION, cmd,
          "cmd/session/start", "NACK", "buzzer_start_failed");
    }
    return RESQ_STATE_ERROR;
  }

  esp_err_t telemetry_err = telemetry_publisher_start();
  if (telemetry_err != ESP_OK) {
    ESP_LOGE(TAG, "Failed to start telemetry publisher: %s",
             esp_err_to_name(telemetry_err));
    buzzer_manager_stop();
    session_sensor_task_stop();
    session_manager_stop(session_id);
    error_manager_set_error(FW_ERROR_TELEMETRY_TASK_FAILED);
    if (cmd != NULL) {
      runtime_helpers_publish_command_result_from_command(
          network_config, RESQ_STATE_READY_FOR_SESSION, cmd,
          "cmd/session/start", "NACK", "telemetry_start_failed");
    }
    return RESQ_STATE_ERROR;
  }

  char event[256];
  int written = snprintf(
      event, sizeof(event),
      "{\"event_id\":%d,\"reply_id\":\"%s\",\"status\":\"ACK\",\"state\":"
      "\"SESSION_ACTIVE\",\"session_id\":\"%s\",\"ts_ms\":%lld}",
      2000, request_id, session_id, (long long)(esp_timer_get_time() / 1000));

  if (written > 0 && mqtt_manager_is_connected()) {
    mqtt_manager_publish_topic_json(RESQ_SUFFIX_EVENTS, event);
  }

  /* publish retained status */
  if (mqtt_manager_is_connected()) {
    mqtt_manager_publish_status(RESQ_STATE_SESSION_ACTIVE, network_config,
                                calibration_config, true, session_id,
                                ip_address);
  }

  return RESQ_STATE_SESSION_ACTIVE;
}

static resq_state_t
recover_session_connectivity(network_config_t *network_config,
                             calibration_config_t *calibration_config,
                             const char *ip_address) {
  const int64_t recovery_started_ms = esp_timer_get_time() / 1000;
  int64_t last_wifi_attempt_ms = 0;
  int64_t last_mqtt_attempt_ms = 0;

  ESP_LOGW(
      TAG,
      "Connectivity lost during active session; starting %d ms recovery window",
      CONNECTIVITY_RECOVERY_TIMEOUT_MS);

  while ((esp_timer_get_time() / 1000) - recovery_started_ms <
         CONNECTIVITY_RECOVERY_TIMEOUT_MS) {
    system_button_action_t action =
        system_button_manager_poll(RESQ_STATE_SESSION_ACTIVE);

    if (action == SYSTEM_BUTTON_ACTION_TURN_OFF ||
        action == SYSTEM_BUTTON_ACTION_FACTORY_RESET) {
      esp_err_t cleanup_err = stop_runtime_components(NULL);
      if (cleanup_err != ESP_OK) {
        ESP_LOGE(
            TAG,
            "Session runtime cleanup failed during connectivity recovery: %s",
            esp_err_to_name(cleanup_err));
      }
      session_manager_stop(NULL);

      return action == SYSTEM_BUTTON_ACTION_TURN_OFF ? RESQ_STATE_TURN_OFF
                                                     : RESQ_STATE_RESETTING;
    }

    if (wifi_manager_is_connected() && mqtt_manager_is_connected()) {
      session_state_t session = {0};
      if (session_manager_get_state(&session) != ESP_OK || !session.active) {
        error_manager_set_error(FW_ERROR_SESSION_INTERRUPTED_UNRECOVERABLE);
        return RESQ_STATE_ERROR;
      }

      char current_ip[16] = {0};
      if (wifi_manager_get_ip(current_ip, sizeof(current_ip)) != ESP_OK) {
        snprintf(current_ip, sizeof(current_ip), "%s",
                 ip_address ? ip_address : "");
      }

      esp_err_t status_err = mqtt_manager_publish_status(
          RESQ_STATE_SESSION_ACTIVE, network_config, calibration_config, true,
          session.session_id, current_ip);

      esp_err_t heartbeat_err = mqtt_manager_publish_heartbeat(
          network_config, calibration_config, RESQ_STATE_SESSION_ACTIVE, true,
          session_active_manager_is_sensor_running(), session.session_id,
          current_ip, wifi_manager_get_rssi());

      if (status_err == ESP_OK && heartbeat_err == ESP_OK) {
        ESP_LOGI(TAG,
                 "Session connectivity recovered; continuing session id=%s",
                 session.session_id);
        return RESQ_STATE_SESSION_ACTIVE;
      }

      ESP_LOGW(TAG,
               "Connectivity returned but resume publish failed: status=%s "
               "heartbeat=%s",
               esp_err_to_name(status_err), esp_err_to_name(heartbeat_err));
    }

    int64_t now_ms = esp_timer_get_time() / 1000;

    if (!wifi_manager_is_connected()) {
      if (last_wifi_attempt_ms == 0 ||
          now_ms - last_wifi_attempt_ms >= CONNECTIVITY_RETRY_INTERVAL_MS) {
        esp_err_t err =
            wifi_manager_reconnect_async(WIFI_MANAGER_DEFAULT_MAX_RETRIES);
        last_wifi_attempt_ms = now_ms;
        if (err != ESP_OK) {
          ESP_LOGW(TAG, "Wi-Fi reconnect request failed: %s status=%d",
                   esp_err_to_name(err),
                   (int)wifi_manager_get_reconnect_status());
        }
      }
    } else if (!mqtt_manager_is_connected()) {
      if (last_mqtt_attempt_ms == 0 ||
          now_ms - last_mqtt_attempt_ms >= CONNECTIVITY_RETRY_INTERVAL_MS) {
        esp_err_t err = mqtt_manager_reconnect_async();
        last_mqtt_attempt_ms = now_ms;
        if (err != ESP_OK) {
          ESP_LOGW(TAG, "MQTT reconnect request failed: %s status=%d",
                   esp_err_to_name(err),
                   (int)mqtt_manager_get_reconnect_status());
        }
      }
    }

    vTaskDelay(pdMS_TO_TICKS(CONNECTIVITY_POLL_INTERVAL_MS));
  }

  session_state_t session = {0};
  char interrupted_session_id[RESQ_SESSION_ID_MAX_LEN] = {0};
  if (session_manager_get_state(&session) == ESP_OK && session.active) {
    strncpy(interrupted_session_id, session.session_id,
            sizeof(interrupted_session_id) - 1);
  }

  cpr_metrics_snapshot_t final_metrics = {0};
  esp_err_t cleanup_err = stop_runtime_components(&final_metrics);
  if (cleanup_err != ESP_OK) {
    ESP_LOGE(TAG,
             "Session runtime cleanup timed out after recovery failure: %s",
             esp_err_to_name(cleanup_err));
  }

  remember_terminal_interruption(interrupted_session_id, &final_metrics);
  session_manager_mark_interrupted("connectivity_recovery_timeout");

  ESP_LOGE(TAG,
           "Connectivity recovery deadline expired; session id=%s is "
           "terminally interrupted",
           interrupted_session_id);
  return RESQ_STATE_SESSION_INTERRUPTED;
}

resq_state_t
session_active_manager_run(network_config_t *network_config,
                           calibration_config_t *calibration_config,
                           const char *ip_address) {
  if (network_config == NULL || calibration_config == NULL) {
    return RESQ_STATE_ERROR;
  }

  if (!session_manager_is_active() ||
      !session_active_manager_is_sensor_running() ||
      !buzzer_manager_is_running() || !telemetry_publisher_is_running()) {
    ESP_LOGE(TAG,
             "Session runtime entered active state without all tasks running");
    stop_runtime_components(NULL);
    session_manager_stop(NULL);
    error_manager_set_error(FW_ERROR_SENSOR_RUNTIME_FAILED);
    return RESQ_STATE_ERROR;
  }

  while (true) {
    system_button_action_t action =
        system_button_manager_poll(RESQ_STATE_SESSION_ACTIVE);
    if (action == SYSTEM_BUTTON_ACTION_TURN_OFF) {
      ESP_LOGW(TAG, "System button requested TURN_OFF during session");
      stop_runtime_components(NULL);
      session_manager_stop(NULL);
      return RESQ_STATE_TURN_OFF;
    }

    if (action == SYSTEM_BUTTON_ACTION_FACTORY_RESET) {
      ESP_LOGW(TAG, "System button requested FACTORY_RESET during session");
      stop_runtime_components(NULL);
      session_manager_stop(NULL);
      return RESQ_STATE_RESETTING;
    }

    if (!wifi_manager_is_connected() || !mqtt_manager_is_connected()) {
      resq_state_t recovery_state = recover_session_connectivity(
          network_config, calibration_config, ip_address);

      if (recovery_state == RESQ_STATE_SESSION_ACTIVE) {
        continue;
      }

      return recovery_state;
    }

    resq_mqtt_command_t command = {0};
    esp_err_t wait_err =
        mqtt_manager_wait_for_command(&command, pdMS_TO_TICKS(200));

    if (wait_err == ESP_ERR_TIMEOUT) {
      continue;
    }

    if (wait_err != ESP_OK) {
      ESP_LOGW(TAG, "Command wait failed during session");
      continue;
    }

    const char *command_suffix =
        runtime_helpers_get_command_suffix(command.topic);
    if (command_suffix == NULL) {
      runtime_helpers_publish_command_result_from_command(
          network_config, RESQ_STATE_SESSION_ACTIVE, &command, "unknown",
          "NACK", "invalid_command_topic");
      continue;
    }

    ESP_LOGI(TAG, "Session active command=%s", command_suffix);

    if (strcmp(command_suffix, RESQ_SUFFIX_CMD_TELEMETRY) == 0) {
      telemetry_publisher_handle_sensor_stream_command(
          network_config, RESQ_STATE_SESSION_ACTIVE, calibration_config,
          &command, false);
      continue;
    }

    if (strcmp(command_suffix, "cmd/session/stop") == 0) {
      /* determine active session id (copy it before stopping) */
      session_state_t current_session = {0};
      char stopped_session_id[RESQ_SESSION_ID_MAX_LEN] = {0};
      if (session_manager_get_state(&current_session) == ESP_OK &&
          current_session.active) {
        strncpy(stopped_session_id, current_session.session_id,
                sizeof(stopped_session_id) - 1);
        stopped_session_id[sizeof(stopped_session_id) - 1] = '\0';
      }

      /* if no active session, reject */
      if (stopped_session_id[0] == '\0') {
        ESP_LOGW(TAG, "No active session for cmd/session/stop; skipping");
        continue;
      }

      /* require request_id before stopping session */
      char reply_id[128] = {0};
      if (resq_command_extract_request_id(command.payload, reply_id,
                                          sizeof(reply_id)) != ESP_OK) {
        ESP_LOGW(TAG, "Missing request_id for cmd/session/stop; skipping stop");
        continue;
      }

      /* parse optional requested session id from payload */
      char requested_session_id[RESQ_SESSION_ID_MAX_LEN] = {0};
      const char *payload = command.payload;
      if (payload && payload[0] != '\0') {
        cJSON *root = cJSON_Parse(payload);
        if (root) {
          cJSON *sid = cJSON_GetObjectItemCaseSensitive(root, "session_id");
          if (!cJSON_IsString(sid) || sid->valuestring == NULL) {
            sid = cJSON_GetObjectItemCaseSensitive(root, "sessionId");
          }
          if (cJSON_IsString(sid) && sid->valuestring) {
            strncpy(requested_session_id, sid->valuestring,
                    sizeof(requested_session_id) - 1);
            requested_session_id[sizeof(requested_session_id) - 1] = '\0';
          }
          cJSON_Delete(root);
        }
      }

      /* if payload contained a session id and it doesn't match active session,
       * reject */
      if (requested_session_id[0] != '\0' &&
          strcmp(requested_session_id, stopped_session_id) != 0) {
        runtime_helpers_publish_command_result_from_command(
            network_config, RESQ_STATE_SESSION_ACTIVE, &command,
            "cmd/session/stop", "NACK", "session_id_mismatch");
        continue;
      }

      cpr_metrics_snapshot_t snap = {0};
      esp_err_t cleanup_err = stop_runtime_components(&snap);
      if (cleanup_err != ESP_OK) {
        ESP_LOGE(TAG, "Session runtime cleanup failed: %s",
                 esp_err_to_name(cleanup_err));
        session_manager_stop(stopped_session_id);
        error_manager_set_error(FW_ERROR_SESSION_INTERRUPTED_UNRECOVERABLE);
        runtime_helpers_publish_command_result_from_command(
            network_config, RESQ_STATE_SESSION_ACTIVE, &command,
            "cmd/session/stop", "NACK", "session_runtime_stop_failed");
        return RESQ_STATE_ERROR;
      }

      esp_err_t stop_err = session_manager_stop(stopped_session_id);
      if (stop_err != ESP_OK) {
        error_manager_set_error(FW_ERROR_SESSION_INTERRUPTED_UNRECOVERABLE);
        runtime_helpers_publish_command_result_from_command(
            network_config, RESQ_STATE_SESSION_ACTIVE, &command,
            "cmd/session/stop", "NACK", "session_stop_failed");
        return RESQ_STATE_ERROR;
      }

      char ev[512];
      int written = snprintf(
          ev, sizeof(ev),
          "{\"event_id\":%d,\"reply_id\":\"%s\",\"status\":\"ACK\",\"result\":"
          "\"STOPPED\",\"session_id\":\"%s\",\"total_compressions\":%d,\"valid_"
          "compressions\":%d,\"recoil_ok_count\":%d,\"incomplete_recoil_"
          "count\":%d,\"state\":\"READY_FOR_SESSION\",\"ts_ms\":%lld}",
          2001, reply_id, stopped_session_id, snap.total_compressions,
          snap.valid_compressions, snap.recoil_ok_count,
          snap.incomplete_recoil_count,
          (long long)(esp_timer_get_time() / 1000));

      if (written > 0 && mqtt_manager_is_connected()) {
        mqtt_manager_publish_topic_json(RESQ_SUFFIX_EVENTS, ev);
        mqtt_manager_publish_status(RESQ_STATE_READY_FOR_SESSION,
                                    network_config, calibration_config, false,
                                    "", ip_address);
      }

      return RESQ_STATE_READY_FOR_SESSION;
    }

    if (strcmp(command_suffix, "cmd/session/start") == 0) {
      runtime_helpers_publish_command_result_from_command(
          network_config, RESQ_STATE_SESSION_ACTIVE, &command,
          "cmd/session/start", "NACK", "session_already_active");
      continue;
    }

    if (strcmp(command_suffix, "cmd/calibration/start") == 0 ||
        strcmp(command_suffix, "cmd/calibration/cancel") == 0) {
      runtime_helpers_publish_command_result_from_command(
          network_config, RESQ_STATE_SESSION_ACTIVE, &command, command_suffix,
          "NACK", "session_active");
      continue;
    }

    if (strcmp(command_suffix, "cmd/debug") == 0) {
      esp_err_t debug_err = publish_debug_snapshot_from_metrics(network_config);
      if (debug_err != ESP_OK) {
        runtime_helpers_publish_command_result_from_command(
            network_config, RESQ_STATE_SESSION_ACTIVE, &command, "cmd/debug",
            "NACK", "debug_read_failed");
        continue;
      }

      runtime_helpers_publish_command_result_from_command(
          network_config, RESQ_STATE_SESSION_ACTIVE, &command, "cmd/debug",
          "ACK", "debug_published");
      continue;
    }

    /* unknown command */
    runtime_helpers_publish_command_result_from_command(
        network_config, RESQ_STATE_SESSION_ACTIVE, &command, command_suffix,
        "NACK", "unknown_command");
  }

  return RESQ_STATE_READY_FOR_SESSION;
}

bool session_active_manager_is_sensor_running(void) {
  bool running = false;

  if (s_mutex == NULL) {
    return false;
  }

  if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(50)) != pdTRUE) {
    return false;
  }

  running = s_sensor_task_run && s_sensor_task != NULL;
  xSemaphoreGive(s_mutex);
  return running;
}

bool session_active_manager_has_pending_interruption(void) {
  return s_pending_interruption.pending;
}

esp_err_t session_active_manager_publish_pending_interruption(
    network_config_t *network_config, calibration_config_t *calibration_config,
    const char *ip_address) {
  if (network_config == NULL || calibration_config == NULL) {
    return ESP_ERR_INVALID_ARG;
  }

  if (!s_pending_interruption.pending) {
    return ESP_OK;
  }

  if (!mqtt_manager_is_connected()) {
    return ESP_ERR_INVALID_STATE;
  }

  if (!s_pending_interruption.event_published) {
    char event[640];
    int written =
        snprintf(event, sizeof(event),
                 "{"
                 "\"event_id\":2002,"
                 "\"status\":\"ACK\","
                 "\"result\":\"INTERRUPTED\","
                 "\"state\":\"SESSION_INTERRUPTED\","
                 "\"session_id\":\"%s\","
                 "\"total_compressions\":%d,"
                 "\"valid_compressions\":%d,"
                 "\"recoil_ok_count\":%d,"
                 "\"incomplete_recoil_count\":%d,"
                 "\"reason_id\":\"06301\","
                 "\"action_id\":11,"
                 "\"ts_ms\":%lld"
                 "}",
                 s_pending_interruption.session_id,
                 s_pending_interruption.metrics.total_compressions,
                 s_pending_interruption.metrics.valid_compressions,
                 s_pending_interruption.metrics.recoil_ok_count,
                 s_pending_interruption.metrics.incomplete_recoil_count,
                 (long long)s_pending_interruption.interrupted_at_ms);

    if (written <= 0 || written >= (int)sizeof(event)) {
      return ESP_ERR_INVALID_SIZE;
    }

    esp_err_t event_err =
        mqtt_manager_publish_topic_json(RESQ_SUFFIX_EVENTS, event);
    if (event_err != ESP_OK) {
      return event_err;
    }

    s_pending_interruption.event_published = true;
  }

  esp_err_t status_err = mqtt_manager_publish_status(
      RESQ_STATE_SESSION_INTERRUPTED, network_config, calibration_config, false,
      "", ip_address);
  if (status_err != ESP_OK) {
    return status_err;
  }

  memset(&s_pending_interruption, 0, sizeof(s_pending_interruption));
  return ESP_OK;
}
