#ifndef FIRMWARE_MQTT_CONTRACT_H
#define FIRMWARE_MQTT_CONTRACT_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"
#include "states.h"

#ifdef __cplusplus
extern "C" {
#endif

#define RESQ_STATUS_QOS 1
#define RESQ_STATUS_RETAIN true
#define RESQ_STATUS_LAST_ERROR_ID_LEN 5
#define RESQ_STATUS_BOOT_ID_LEN 16
#define RESQ_STATUS_SESSION_ID_MAX_LEN 64
#define RESQ_STATUS_CALIBRATION_STORAGE_STATUS_MAX_LEN 32
#define RESQ_STATUS_CALIBRATION_PROFILE_ID_MAX_LEN 31
#define RESQ_STATUS_CALIBRATION_PROFILE_HASH_LEN 64
#ifndef RESQ_HEARTBEAT_INTERVAL_MS
#define RESQ_HEARTBEAT_INTERVAL_MS 5000
#endif

typedef struct {
  resq_state_t state;
  bool session_active;
  char session_id[RESQ_STATUS_SESSION_ID_MAX_LEN];
  bool calibrated;
  uint32_t calibration_schema_version;
  uint32_t calibration_generation;
  char calibration_storage_status
      [RESQ_STATUS_CALIBRATION_STORAGE_STATUS_MAX_LEN];
  bool recalibration_required;
  char profile_id[RESQ_STATUS_CALIBRATION_PROFILE_ID_MAX_LEN + 1];
  uint32_t profile_version;
  char profile_hash[RESQ_STATUS_CALIBRATION_PROFILE_HASH_LEN + 1];
  char last_error_id[RESQ_STATUS_LAST_ERROR_ID_LEN + 1];
  char boot_id[RESQ_STATUS_BOOT_ID_LEN + 1];
  uint32_t state_seq;
  int64_t ts_ms;
} resq_status_contract_t;

typedef struct {
  resq_state_t state;
  bool session_active;
  bool sensor_running;
  bool calibrated;
  /* Compatibility alias. ts_ms is the canonical monotonic timestamp. */
  int64_t uptime_ms;
  int64_t ts_ms;
} resq_heartbeat_contract_t;

/**
 * Build the locked minimal retained-status payload.
 *
 * The caller owns the returned cJSON allocation and must release it with
 * cJSON_free().
 */
esp_err_t resq_mqtt_contract_build_status(
    const resq_status_contract_t *status, char **out_payload);

/**
 * Compare effective status content. Firmware uptime (`ts_ms`) is deliberately
 * excluded so periodic calls cannot create duplicate retained publications.
 */
bool resq_mqtt_contract_status_equivalent(
    const resq_status_contract_t *left,
    const resq_status_contract_t *right);

esp_err_t resq_mqtt_contract_build_heartbeat(
    const resq_heartbeat_contract_t *heartbeat, char **out_payload);

/**
 * Return the next stable heartbeat deadline. A late caller advances by whole
 * intervals instead of scheduling relative to completion time.
 */
uint32_t resq_mqtt_contract_next_heartbeat_deadline(
    uint32_t previous_deadline_ms, uint32_t now_ms, uint32_t interval_ms);

#ifdef __cplusplus
}
#endif

#endif
