#ifndef BACKEND_REGISTER_CLIENT_H
#define BACKEND_REGISTER_CLIENT_H

#include "esp_err.h"
#include "resq_config_types.h"
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define BACKEND_REGISTER_MAX_RETRIES     3
#define BACKEND_REGISTER_TIMEOUT_MS      5000

esp_err_t backend_register_client_init(void);

typedef struct {
	char device_id[RESQ_DEVICE_ID_MAX_LEN];
	char mqtt_host[RESQ_MQTT_HOST_MAX_LEN];
	uint16_t mqtt_port;
} backend_registration_result_t;

/**
 * @brief Register ESP device with LocalHub backend.
 *
 * Uses:
 * - config->backend_base_url (will POST to base + "/api/devices/register")
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
/**
 * @brief Register ESP device with LocalHub backend.
 *
 * Performs registration using only runtime values from `config` (e.g. backend_base_url)
 * and the hardware MAC read at runtime. The function returns backend-assigned
 * identifiers in `out_result` but DOES NOT persist them.
 */
esp_err_t backend_register_client_register(const network_config_t *config,
										   backend_registration_result_t *out_result);

#ifdef __cplusplus
}
#endif

#endif /* BACKEND_REGISTER_CLIENT_H */
