#ifndef BACKEND_REGISTER_CLIENT_H
#define BACKEND_REGISTER_CLIENT_H

#include "esp_err.h"
#include "resq_config_types.h"

#ifdef __cplusplus
extern "C" {
#endif

#define BACKEND_REGISTER_MAX_RETRIES     3
#define BACKEND_REGISTER_TIMEOUT_MS      5000

esp_err_t backend_register_client_init(void);

/**
 * @brief Register ESP device with LocalHub backend.
 *
 * Uses:
 * - config->register_url
 * - config->device_mac
 *
 * Sends (JSON request):
 * {
 *   "device_mac": "...",
 *   "device_id": "...",
 *   "firmware_version": "0.1.0"
 * }
 *
 * Requires backend response to contain:
 * - device_id (non-empty string)
 *
 * Optionally updates if response contains:
 * - mqtt_host
 * - mqtt_port
 */
esp_err_t backend_register_client_register(network_config_t *config);

#ifdef __cplusplus
}
#endif

#endif /* BACKEND_REGISTER_CLIENT_H */
