#ifndef BACKEND_REGISTER_CLIENT_H
#define BACKEND_REGISTER_CLIENT_H

#include "esp_err.h"
#include "resq_config_types.h"
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define BACKEND_REGISTER_MAX_RETRIES     3
#define BACKEND_REGISTER_TIMEOUT_MS      5000
#define BACKEND_REGISTER_PATH            "/api/devices/register"

esp_err_t backend_register_client_init(void);

typedef struct {
	char device_id[RESQ_DEVICE_ID_MAX_LEN];
	char mqtt_host[RESQ_MQTT_HOST_MAX_LEN];
	uint16_t mqtt_port;
} backend_registration_result_t;

/**
 * @brief Compose the configured base URL with the registration path.
 */
esp_err_t backend_register_client_build_url(const char *backend_base_url,
                                            char *out_url,
                                            size_t out_url_len);

/**
 * @brief Build the current registration JSON contract.
 *
 * The request preserves the existing `device_mac` and `firmware_version`
 * fields. The Wi-Fi password is never included.
 */
esp_err_t backend_register_client_build_request_body(const char *device_mac,
                                                     char *out_body,
                                                     size_t out_body_len);

/**
 * @brief Parse a registration response transactionally.
 *
 * Requires valid `device_id`, `mqtt_host`, and `mqtt_port` fields. On failure,
 * @p out_result is unchanged.
 */
esp_err_t backend_register_client_parse_response(
    const char *response_json,
    backend_registration_result_t *out_result);

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
