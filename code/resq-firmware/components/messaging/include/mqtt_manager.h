#pragma once

#include <stdbool.h>

#include "esp_err.h"
#include "config_store.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Callback function type for handling incoming MQTT commands.
 *
 * @param suffix The command suffix (e.g., "cmd/session/start")
 * @param payload The command payload as JSON string
 * @param ctx Optional context pointer passed during callback registration
 * @return ESP_OK if handled, ESP_ERR_NOT_SUPPORTED if not recognized,
 *         or other error code on failure
 */
typedef esp_err_t (*mqtt_command_handler_cb_t)(
    const char *suffix,
    const char *payload,
    void *ctx
);

/**
 * @brief Callback function type for rejecting MQTT commands.
 *
 * @param suffix The command suffix that was rejected
 * @param reason Human-readable reason for rejection
 * @param ctx Optional context pointer passed during callback registration
 * @return ESP_OK on success, error code on failure
 */
typedef esp_err_t (*mqtt_command_reject_cb_t)(
    const char *suffix,
    const char *reason,
    void *ctx
);

esp_err_t mqtt_manager_init(const device_config_t *cfg);
esp_err_t mqtt_manager_start(void);
bool mqtt_manager_is_connected(void);
esp_err_t mqtt_manager_publish_status(const char *state);

/**
 * @brief Register callbacks for command handling.
 *
 * mqtt_manager will call these callbacks when commands are received.
 * This allows the runtime layer to handle commands without mqtt_manager
 * knowing about command_handler or other runtime components.
 *
 * @param handle_cb Callback to handle commands (required)
 * @param reject_cb Callback to reject commands (optional, may be NULL)
 * @param ctx Optional context pointer passed to both callbacks
 * @return ESP_OK on success, ESP_ERR_INVALID_ARG if handle_cb is NULL
 */
esp_err_t mqtt_manager_set_command_callbacks(
    mqtt_command_handler_cb_t handle_cb,
    mqtt_command_reject_cb_t reject_cb,
    void *ctx
);

/**
 * @brief Publish to a device-scoped topic suffix.
 *
 * Example:
 * suffix = "telemetry"
 * final topic = resq/manikins/<device_id>/telemetry
 */
esp_err_t mqtt_manager_publish(
    const char *suffix, 
    const char *payload, 
    int qos, int retain
);

#ifdef __cplusplus
}
#endif