#ifndef RUNTIME_HELPERS_H
#define RUNTIME_HELPERS_H

#include "esp_err.h"

#include "resq_config_types.h"
#include "states.h"
#include "mqtt_manager.h"
#include <stdint.h>

#include "mqtt_topics.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Get best available firmware device identifier.
 *
 * Priority:
 * 1. backend-assigned device_id
 * 2. hardware device_mac
 * 3. "unknown"
 */
const char *runtime_helpers_get_device_id(const network_config_t *config);

/**
 * @brief Extract command suffix from full MQTT topic.
 *
 * Example:
 * input:  resq/resq-node-01/cmd/debug
 * output: cmd/debug
 *
 * Returns NULL if topic does not contain /cmd/.
 */
const char *runtime_helpers_get_command_suffix(const char *topic);

/**
 * @brief Publish a standard firmware error event to MQTT events topic.
 */
esp_err_t runtime_helpers_publish_error_event(const network_config_t *network_config,
                                              resq_state_t state,
                                              const char *error_code,
                                              const char *message);

/**
 * @brief LEGACY: Publish a standard command result event to MQTT events topic.
 *
 * This function is legacy and does not follow the Phase-1 contract that
 * requires replies to include `reply_id` (the original command's
 * `request_id`). Prefer `runtime_helpers_publish_command_result_from_command()`
 * which extracts the request_id from the incoming `resq_mqtt_command_t` and
 * emits a proper reply. The legacy helper remains for backward compatibility
 * but should not be used in new command handlers.
 */
esp_err_t runtime_helpers_publish_command_result(const network_config_t *network_config,
                                                 resq_state_t state,
                                                 const char *command,
                                                 const char *status,
                                                 const char *reason);

/**
 * @brief Publish a command result using the incoming MQTT command context.
 * Extracts request_id (or falls back to command_id) and emits a reply with reply_id.
 */
esp_err_t runtime_helpers_publish_command_result_from_command(const network_config_t *network_config,
                                                              resq_state_t state,
                                                              const resq_mqtt_command_t *cmd,
                                                              const char *command_suffix,
                                                              const char *status,
                                                              const char *reason);

/**
 * @brief Extract request_id from a command payload. Falls back to command_id for compatibility.
 */
esp_err_t resq_command_extract_request_id(const char *payload, char *out, size_t out_len);

/**
 * @brief Publish a minimal calibration result event to MQTT events/calibration.
 * If `reply_id` is NULL or empty, the caller should not call this (calibration
 * results published as replies must include a non-empty reply_id).
 */
/* Calibration result publishing moved to calibration_manager to avoid circular
 * component dependencies. Use `calibration_manager_publish_calibration_result()`
 * from `calibration_manager.h` instead. */

/**
 * @brief Publish a debug snapshot (raw sensor readings) to debug topic.
 */
esp_err_t runtime_helpers_publish_debug_snapshot(const network_config_t *network_config);

/* Record a state transition for STATE_SNAPSHOT diagnostics. */
void runtime_helpers_record_state(resq_state_t state);

resq_state_t runtime_helpers_get_current_state(void);
resq_state_t runtime_helpers_get_previous_state(void);
int64_t runtime_helpers_get_state_entered_at_ms(void);

/* Publish a full STATE_SNAPSHOT JSON to the debug topic. */
esp_err_t runtime_helpers_publish_state_snapshot(
    const network_config_t *network_config,
    const calibration_config_t *calibration_config,
    const char *reply_id);

#ifdef __cplusplus
}
#endif

#endif /* RUNTIME_HELPERS_H */
