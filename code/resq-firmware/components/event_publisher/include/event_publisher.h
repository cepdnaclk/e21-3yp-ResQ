#pragma once

#include <stdbool.h>
#include "esp_err.h"
#include "config_store.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Initialize the event publisher with device configuration.
 *
 * Must be called once before any publishing operations.
 *
 * @param cfg Device configuration pointer (must be valid, will be copied internally)
 * @return ESP_OK on success, ESP_ERR_INVALID_ARG if cfg is NULL
 */
esp_err_t event_publisher_init(const device_config_t *cfg);

/**
 * @brief Check if the event publisher is connected to MQTT.
 *
 * @return true if connected to MQTT, false otherwise
 */
bool event_publisher_is_connected(void);

/**
 * @brief Publish or queue a raw payload to a device-scoped suffix.
 *
 * Routes to MQTT if connected, otherwise queues for later delivery.
 *
 * @param suffix Device-scoped topic suffix (e.g., "telemetry", "status")
 * @param payload Payload string (must be valid JSON)
 * @param qos MQTT QoS level (0 or 1)
 * @param retain MQTT retain flag (0 or 1)
 * @return ESP_OK on success, ESP_ERR_INVALID_ARG if payload/suffix is NULL,
 *         ESP_ERR_INVALID_STATE if event_publisher_init() not called
 */
esp_err_t event_publisher_publish_or_queue(
    const char *suffix,
    const char *payload,
    int qos,
    int retain
);

/**
 * @brief Publish device status with session information.
 *
 * Builds a status payload and publishes to RESQ_SUFFIX_STATUS (QoS 1, retain=true).
 *
 * @param state Device state string (e.g., "online", "error")
 * @param session_active Whether a session is currently active
 * @param session_id Session identifier (must be valid if session_active is true)
 * @return ESP_OK on success, ESP_ERR_INVALID_ARG if state or session_id is NULL,
 *         ESP_ERR_INVALID_STATE if event_publisher_init() not called
 */
esp_err_t event_publisher_publish_status(
    const char *state,
    bool session_active,
    const char *session_id
);

/**
 * @brief Publish a command execution result.
 *
 * Builds a command result payload and publishes to RESQ_SUFFIX_EVENTS (QoS 1, retain=false).
 *
 * @param command Command name that was executed
 * @param status Execution status ("success", "failed", etc.)
 * @param reason Reason for the status (NULL if successful)
 * @param session_id Session identifier associated with this result
 * @return ESP_OK on success, ESP_ERR_INVALID_ARG if required args are NULL,
 *         ESP_ERR_INVALID_STATE if event_publisher_init() not called
 */
esp_err_t event_publisher_publish_command_result(
    const char *command,
    const char *status,
    const char *reason,
    const char *session_id
);

/**
 * @brief Publish a sensor fault event.
 *
 * Builds a fault event payload and publishes to RESQ_SUFFIX_EVENTS (QoS 1, retain=false).
 *
 * @param session_id Session identifier (may be empty if no active session)
 * @param fault_code Fault identifier (e.g., "FORCE1_FAIL", "HALL_FAIL")
 * @param message Human-readable fault description
 * @param active Whether the fault is currently active (true) or resolved (false)
 * @return ESP_OK on success, ESP_ERR_INVALID_ARG if required args are NULL,
 *         ESP_ERR_INVALID_STATE if event_publisher_init() not called
 */
esp_err_t event_publisher_publish_fault(
    const char *session_id,
    const char *fault_code,
    const char *message,
    bool active
);

#ifdef __cplusplus
}
#endif
