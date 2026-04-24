#pragma once

#include <stdbool.h>

#include "esp_err.h"
#include "freertos/FreeRTOS.h"

#include "config_store.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Start temporary AP mode + local HTTP provisioning server.
 */
esp_err_t provisioning_start(void);

/**
 * @brief Stop provisioning AP and HTTP server.
 */
esp_err_t provisioning_stop(void);

/**
 * @brief Wait until provisioning data is received and saved.
 *
 * @param out_cfg Caller-provided output config
 * @param timeout_ticks FreeRTOS timeout
 */
esp_err_t provisioning_wait_for_config(device_config_t *out_cfg, TickType_t timeout_ticks);

/**
 * @brief Returns true if provisioning server/AP is currently active.
 */
bool provisioning_is_active(void);

#ifdef __cplusplus
}
#endif