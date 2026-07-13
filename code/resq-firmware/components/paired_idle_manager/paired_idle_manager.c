#include "paired_idle_manager.h"

#include <stdbool.h>
#include <stdio.h>
#include <string.h>

#include "cJSON.h"

#include "esp_err.h"
#include "esp_log.h"
#include "esp_timer.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "board_config.h"
#include "calibration_manager.h"
#include "error_manager.h"
#include "hall_sensor.h"
#include "hx710.h"
#include "mqtt_manager.h"
#include "mqtt_topics.h"
#include "runtime_helpers.h"
#include "session_active_manager.h"
#include "status_indicator.h"
#include "system_button_manager.h"
#include "telemetry_publisher.h"
#include "wifi_manager.h"

static const char *TAG = "paired_idle";

static bool s_initialized = false;

/* debug snapshot publishing moved to runtime_helpers_publish_debug_snapshot()
 */

static esp_err_t
paired_idle_parse_session_start(const char *payload, char *out_command_id,
                                size_t command_id_len, char *out_session_id,
                                size_t session_id_len, char *out_profile_id,
                                size_t profile_id_len) {
  if (payload == NULL || out_session_id == NULL)
    return ESP_ERR_INVALID_ARG;

  cJSON *root = cJSON_Parse(payload);
  if (root == NULL)
    return ESP_FAIL;

  esp_err_t result = ESP_OK;

  /* Prefer request_id, fall back to command_id for compatibility */
  cJSON *command_id = cJSON_GetObjectItemCaseSensitive(root, "request_id");
  if (!cJSON_IsString(command_id) || command_id->valuestring == NULL) {
    command_id = cJSON_GetObjectItemCaseSensitive(root, "command_id");
  }
  cJSON *session_id = cJSON_GetObjectItemCaseSensitive(root, "session_id");
  cJSON *sessionId = cJSON_GetObjectItemCaseSensitive(root, "sessionId");
  cJSON *profile_id = cJSON_GetObjectItemCaseSensitive(root, "profile_id");

  /* Require either request_id (preferred) or legacy command_id, and a session
   * id. */
  if (!cJSON_IsString(command_id) || command_id->valuestring == NULL) {
    result = ESP_ERR_INVALID_ARG;
    goto exit;
  }

  const char *sid = NULL;
  if (cJSON_IsString(session_id) && session_id->valuestring != NULL)
    sid = session_id->valuestring;
  if (sid == NULL && cJSON_IsString(sessionId) &&
      sessionId->valuestring != NULL)
    sid = sessionId->valuestring;

  if (sid == NULL) {
    result = ESP_ERR_INVALID_ARG;
    goto exit;
  }

  if (out_session_id && session_id_len > 0) {
    strncpy(out_session_id, sid, session_id_len - 1);
    out_session_id[session_id_len - 1] = '\0';
  }

  if (out_command_id != NULL && command_id_len > 0) {
    if (cJSON_IsString(command_id) && command_id->valuestring) {
      strncpy(out_command_id, command_id->valuestring, command_id_len - 1);
      out_command_id[command_id_len - 1] = '\0';
    } else {
      out_command_id[0] = '\0';
    }
  }

  if (out_profile_id != NULL && profile_id_len > 0) {
    if (cJSON_IsString(profile_id) && profile_id->valuestring) {
      strncpy(out_profile_id, profile_id->valuestring, profile_id_len - 1);
      out_profile_id[profile_id_len - 1] = '\0';
    } else {
      out_profile_id[0] = '\0';
    }
  }

exit:
  cJSON_Delete(root);
  return result;
}

esp_err_t paired_idle_manager_init(void) {
  if (s_initialized) {
    return ESP_OK;
  }

  s_initialized = true;

  ESP_LOGI(TAG, "Paired idle manager initialized");

  return ESP_OK;
}

resq_state_t paired_idle_manager_run(network_config_t *network_config,
                                     calibration_config_t *calibration_config,
                                     const char *ip_address) {
  if (!s_initialized) {
    return RESQ_STATE_ERROR;
  }

  if (network_config == NULL || calibration_config == NULL) {
    return RESQ_STATE_ERROR;
  }

  resq_state_t visible_state = calibration_config->calibrated
                                   ? RESQ_STATE_READY_FOR_SESSION
                                   : RESQ_STATE_PAIRED_IDLE;

  status_indicator_set_state(visible_state);

  /* Publish retained status on entry. */
  mqtt_manager_publish_status(visible_state, network_config, calibration_config,
                              false, "", ip_address);

  while (true) {
    system_button_action_t action = system_button_manager_poll(visible_state);
    if (action == SYSTEM_BUTTON_ACTION_TURN_OFF) {
      ESP_LOGW(TAG, "System button requested TURN_OFF in paired idle");
      telemetry_publisher_stop_sensor_stream();
      return RESQ_STATE_TURN_OFF;
    }

    if (action == SYSTEM_BUTTON_ACTION_FACTORY_RESET) {
      ESP_LOGW(TAG, "System button requested FACTORY_RESET in paired idle");
      telemetry_publisher_stop_sensor_stream();
      return RESQ_STATE_RESETTING;
    }
    visible_state = calibration_config->calibrated
                        ? RESQ_STATE_READY_FOR_SESSION
                        : RESQ_STATE_PAIRED_IDLE;

    if (!wifi_manager_is_connected()) {
      telemetry_publisher_stop_sensor_stream();
      error_manager_set_error(FW_ERROR_WIFI_DISCONNECTED_UNRECOVERABLE);
      return RESQ_STATE_ERROR;
    }

    if (!mqtt_manager_is_connected()) {
      telemetry_publisher_stop_sensor_stream();
      error_manager_set_error(FW_ERROR_MQTT_DISCONNECTED_UNRECOVERABLE);
      return RESQ_STATE_ERROR;
    }

    resq_mqtt_command_t command = {0};
    esp_err_t wait_err =
        mqtt_manager_wait_for_command(&command, pdMS_TO_TICKS(500));

    if (wait_err == ESP_ERR_TIMEOUT) {
      continue;
    }

    if (wait_err != ESP_OK) {
      /* Non-timeout error while waiting for commands - treat as MQTT failure */
      error_manager_set_error(FW_ERROR_MQTT_SUBSCRIBE_FAILED);
      return RESQ_STATE_ERROR;
    }

    const char *command_suffix =
        runtime_helpers_get_command_suffix(command.topic);

    if (command_suffix == NULL) {
      runtime_helpers_publish_command_result_from_command(
          network_config, visible_state, &command, "unknown", "NACK",
          "invalid_command_topic");
      runtime_helpers_publish_error_event(
          network_config, visible_state, "INVALID_COMMAND_TOPIC",
          "Command topic does not contain /cmd/");
      continue;
    }

    ESP_LOGI(TAG, "Command suffix=%s visible_state=%s", command_suffix,
             resq_state_to_string(visible_state));

    if (strcmp(command_suffix, RESQ_SUFFIX_CMD_TELEMETRY) == 0) {
      telemetry_publisher_handle_sensor_stream_command(
          network_config, visible_state, calibration_config, &command, true);
      continue;
    }

    if (strcmp(command_suffix, "cmd/debug") == 0) {
      esp_err_t debug_err =
          runtime_helpers_publish_debug_snapshot(network_config);

      if (debug_err != ESP_OK) {
        runtime_helpers_publish_command_result_from_command(
            network_config, visible_state, &command, command_suffix, "NACK",
            "debug_read_failed");
        continue;
      }

      runtime_helpers_publish_command_result_from_command(
          network_config, visible_state, &command, command_suffix, "ACK",
          "debug_published");
      continue;
    }

    if (strcmp(command_suffix, "cmd/calibration/cancel") == 0) {
      char reply_id[128] = {0};
      if (resq_command_extract_request_id(command.payload, reply_id,
                                          sizeof(reply_id)) != ESP_OK) {
        ESP_LOGW(TAG, "Missing request_id for %s; skipping calibration cancel",
                 command_suffix);
        continue;
      }

      esp_err_t pub_err = runtime_helpers_publish_command_result_from_command(
          network_config, visible_state, &command, command_suffix, "ACK",
          "no_active_calibration");
      if (pub_err != ESP_OK) {
        ESP_LOGW(
            TAG,
            "Failed to publish command result for %s; skipping cancel (err=%d)",
            command_suffix, pub_err);
        continue;
      }

      calibration_manager_publish_calibration_result(
          reply_id, "ACK", "CANCELLED", CAL_REASON_CALIBRATION_CANCELLED,
          RESQ_STATE_PAIRED_IDLE, CAL_ACTION_MOVE_TO_PAIRED_IDLE_DROP_TEMP);
      continue;
    }

    if (strcmp(command_suffix, "cmd/session/start") == 0) {
      char reply_id[128] = {0};
      if (resq_command_extract_request_id(command.payload, reply_id,
                                          sizeof(reply_id)) != ESP_OK) {
        ESP_LOGW(
            TAG,
            "Missing request_id for cmd/session/start; skipping session start");
        continue;
      }

      char command_id[128] = {0};
      char session_id[128] = {0};
      char profile_id[128] = {0};

      esp_err_t parse_err = paired_idle_parse_session_start(
          command.payload, command_id, sizeof(command_id), session_id,
          sizeof(session_id), profile_id, sizeof(profile_id));

      if (parse_err != ESP_OK) {
        runtime_helpers_publish_command_result_from_command(
            network_config, visible_state, &command, "cmd/session/start",
            "NACK", "invalid_session_start_payload");
        runtime_helpers_publish_error_event(network_config, visible_state,
                                            "INVALID_SESSION_START_PAYLOAD",
                                            "invalid_session_start_payload");
        continue;
      }

      /* Require calibrated flag plus manager readiness and validated adaptive
       * thresholds */
      if (!calibration_config->calibrated || !calibration_manager_is_ready() ||
          !calibration_config_validate(calibration_config)) {
        runtime_helpers_publish_command_result_from_command(
            network_config, visible_state, &command, "cmd/session/start",
            "NACK", "calibration_not_ready");
        continue;
      }

      if (!calibration_profile_matches(calibration_config, profile_id)) {
        runtime_helpers_publish_command_result_from_command(
            network_config, visible_state, &command, "cmd/session/start",
            "NACK", "profile_mismatch");
        continue;
      }

      esp_err_t stream_stop_err = telemetry_publisher_stop_sensor_stream();
      if (stream_stop_err != ESP_OK) {
        runtime_helpers_publish_command_result_from_command(
            network_config, visible_state, &command, "cmd/session/start",
            "NACK", "07102");
        continue;
      }

      /* attempt to start active session; pass full command context so the
       * session manager can reply using the request_id */
      resq_state_t start_state = session_active_manager_start(
          network_config, calibration_config, ip_address, session_id,
          profile_id, &command);

      if (start_state == RESQ_STATE_SESSION_ACTIVE) {
        return RESQ_STATE_SESSION_ACTIVE;
      }

      /* otherwise stay in current visible state */
      continue;
    }

    if (strcmp(command_suffix, "cmd/calibration/start") == 0) {
      char reply_id[128] = {0};
      if (resq_command_extract_request_id(command.payload, reply_id,
                                          sizeof(reply_id)) != ESP_OK) {
        ESP_LOGW(TAG, "Missing request_id for cmd/calibration/start; skipping "
                      "calibration start");
        continue;
      }

      char command_id[128] = {0};
      calibration_reason_id_t parse_reason = CAL_REASON_NONE;

      esp_err_t parse_err = calibration_manager_parse_start_payload(
          command.payload, calibration_config, command_id, sizeof(command_id),
          &parse_reason);

      if (parse_err != ESP_OK) {
        runtime_helpers_publish_command_result_from_command(
            network_config, visible_state, &command, "cmd/calibration/start",
            "NACK", "invalid_calibration_payload");

        calibration_manager_publish_progress_event(
            parse_reason, visible_state, CAL_ACTION_SEND_VALID_PAYLOAD, 0);

        runtime_helpers_publish_error_event(network_config, visible_state,
                                            "INVALID_CALIBRATION_PAYLOAD",
                                            "invalid_calibration_payload");
        continue;
      }

      /* If calibration is already running, NACK and publish progress */
      if (calibration_manager_is_running()) {
        if (strcmp(reply_id, calibration_manager_get_request_id()) == 0) {
          runtime_helpers_publish_command_result_from_command(
              network_config, visible_state, &command, "cmd/calibration/start",
              "ACK", "duplicate_request_ignored");
          continue;
        }

        runtime_helpers_publish_command_result_from_command(
            network_config, visible_state, &command, "cmd/calibration/start",
            "NACK", "calibration_already_running");

        calibration_manager_publish_progress_event(
            CAL_REASON_CALIBRATION_ALREADY_RUNNING, RESQ_STATE_CALIBRATING,
            CAL_ACTION_WAIT_OR_CANCEL, 0);
        continue;
      }

      calibration_config->calibrated = false;

      esp_err_t stream_stop_err = telemetry_publisher_stop_sensor_stream();
      if (stream_stop_err != ESP_OK) {
        runtime_helpers_publish_command_result_from_command(
            network_config, visible_state, &command, "cmd/calibration/start",
            "NACK", "07102");
        continue;
      }

      /* Store request_id before start so task-owned progress can correlate
       * replies. */
      calibration_manager_set_request_id(reply_id);

      esp_err_t start_err =
          calibration_manager_start(network_config, calibration_config,
                                    command_id[0] != '\0' ? command_id : NULL);

      if (start_err != ESP_OK) {
        runtime_helpers_publish_command_result_from_command(
            network_config, visible_state, &command, "cmd/calibration/start",
            "NACK", "calibration_start_failed");

        calibration_manager_publish_calibration_result(
            reply_id, "NACK", "FAIL", CAL_REASON_NONE, visible_state,
            CAL_ACTION_NONE);
        continue;
      }

      esp_err_t pub_err = runtime_helpers_publish_command_result_from_command(
          network_config, visible_state, &command, "cmd/calibration/start",
          "ACK", "moving_to_calibrating");
      if (pub_err != ESP_OK) {
        ESP_LOGW(TAG,
                 "Failed to publish command result for cmd/calibration/start "
                 "after startup (err=%d)",
                 pub_err);
      }

      calibration_manager_publish_calibration_result(
          reply_id, "ACK", "STARTED", CAL_REASON_NONE, RESQ_STATE_CALIBRATING,
          CAL_ACTION_NONE);

      return RESQ_STATE_CALIBRATING;
    }

    runtime_helpers_publish_command_result_from_command(
        network_config, visible_state, &command, command_suffix, "NACK",
        "unknown_command");

    runtime_helpers_publish_error_event(network_config, visible_state,
                                        "UNKNOWN_COMMAND", command_suffix);
  }
}
