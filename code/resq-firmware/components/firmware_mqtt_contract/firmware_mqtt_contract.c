#include "firmware_mqtt_contract.h"

#include <string.h>

#include "cJSON.h"

static bool fixed_text_valid(const char *value, size_t expected_len) {
  return value != NULL && strnlen(value, expected_len + 1) == expected_len;
}

esp_err_t resq_mqtt_contract_build_status(
    const resq_status_contract_t *status, char **out_payload) {
  if (status == NULL || out_payload == NULL ||
      !fixed_text_valid(status->last_error_id,
                        RESQ_STATUS_LAST_ERROR_ID_LEN) ||
      !fixed_text_valid(status->boot_id, RESQ_STATUS_BOOT_ID_LEN) ||
      status->state_seq == 0) {
    return ESP_ERR_INVALID_ARG;
  }
  *out_payload = NULL;

  cJSON *root = cJSON_CreateObject();
  if (root == NULL) {
    return ESP_ERR_NO_MEM;
  }

  cJSON_AddStringToObject(root, "state", resq_state_to_string(status->state));
  cJSON_AddBoolToObject(root, "session_active", status->session_active);
  if (status->session_id[0] != '\0') {
    cJSON_AddStringToObject(root, "session_id", status->session_id);
  }
  cJSON_AddBoolToObject(root, "calibrated", status->calibrated);
  cJSON_AddStringToObject(root, "last_error_id", status->last_error_id);
  cJSON_AddStringToObject(root, "boot_id", status->boot_id);
  cJSON_AddNumberToObject(root, "state_seq", status->state_seq);
  cJSON_AddNumberToObject(root, "ts_ms", status->ts_ms);

  *out_payload = cJSON_PrintUnformatted(root);
  cJSON_Delete(root);
  return *out_payload == NULL ? ESP_ERR_NO_MEM : ESP_OK;
}

bool resq_mqtt_contract_status_equivalent(
    const resq_status_contract_t *left,
    const resq_status_contract_t *right) {
  if (left == NULL || right == NULL) {
    return false;
  }
  return left->state == right->state &&
         left->session_active == right->session_active &&
         strcmp(left->session_id, right->session_id) == 0 &&
         left->calibrated == right->calibrated &&
         strcmp(left->last_error_id, right->last_error_id) == 0 &&
         strcmp(left->boot_id, right->boot_id) == 0 &&
         left->state_seq == right->state_seq;
}

esp_err_t resq_mqtt_contract_build_heartbeat(
    const resq_heartbeat_contract_t *heartbeat, char **out_payload) {
  if (heartbeat == NULL || out_payload == NULL ||
      heartbeat->uptime_ms < 0 || heartbeat->ts_ms < 0) {
    return ESP_ERR_INVALID_ARG;
  }
  *out_payload = NULL;

  cJSON *root = cJSON_CreateObject();
  if (root == NULL) {
    return ESP_ERR_NO_MEM;
  }
  cJSON_AddStringToObject(root, "state",
                         resq_state_to_string(heartbeat->state));
  cJSON_AddBoolToObject(root, "session_active",
                        heartbeat->session_active);
  cJSON_AddBoolToObject(root, "sensor_running",
                        heartbeat->sensor_running);
  cJSON_AddBoolToObject(root, "calibrated", heartbeat->calibrated);
  cJSON_AddNumberToObject(root, "uptime_ms", heartbeat->uptime_ms);
  cJSON_AddNumberToObject(root, "ts_ms", heartbeat->ts_ms);

  *out_payload = cJSON_PrintUnformatted(root);
  cJSON_Delete(root);
  return *out_payload == NULL ? ESP_ERR_NO_MEM : ESP_OK;
}

uint32_t resq_mqtt_contract_next_heartbeat_deadline(
    uint32_t previous_deadline_ms, uint32_t now_ms, uint32_t interval_ms) {
  if (interval_ms == 0) {
    return now_ms;
  }
  if (previous_deadline_ms == 0) {
    return now_ms + interval_ms;
  }

  uint32_t next = previous_deadline_ms + interval_ms;
  if ((int32_t)(now_ms - next) < 0) {
    return next;
  }
  uint32_t elapsed = now_ms - previous_deadline_ms;
  uint32_t intervals = elapsed / interval_ms + 1;
  return previous_deadline_ms + intervals * interval_ms;
}
