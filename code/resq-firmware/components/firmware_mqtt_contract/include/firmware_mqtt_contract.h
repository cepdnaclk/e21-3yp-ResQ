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

typedef struct {
  resq_state_t state;
  bool session_active;
  char session_id[RESQ_STATUS_SESSION_ID_MAX_LEN];
  bool calibrated;
  char last_error_id[RESQ_STATUS_LAST_ERROR_ID_LEN + 1];
  char boot_id[RESQ_STATUS_BOOT_ID_LEN + 1];
  uint32_t state_seq;
  int64_t ts_ms;
} resq_status_contract_t;

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

#ifdef __cplusplus
}
#endif

#endif
