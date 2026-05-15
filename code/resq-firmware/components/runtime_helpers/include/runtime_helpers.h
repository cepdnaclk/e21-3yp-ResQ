#ifndef RUNTIME_HELPERS_H
#define RUNTIME_HELPERS_H

#include "esp_err.h"

#include "resq_config_types.h"
#include "states.h"

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
 * @brief Publish a standard command result event to MQTT events topic.
 */
esp_err_t runtime_helpers_publish_command_result(const network_config_t *network_config,
                                                 resq_state_t state,
                                                 const char *command,
                                                 const char *status,
                                                 const char *reason);

#ifdef __cplusplus
}
#endif

#endif /* RUNTIME_HELPERS_H */
