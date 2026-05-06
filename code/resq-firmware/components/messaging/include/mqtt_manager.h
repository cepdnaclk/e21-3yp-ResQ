#pragma once

#include <stdbool.h>

#include "esp_err.h"
#include "config_store.h"

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t mqtt_manager_init(const device_config_t *cfg);
esp_err_t mqtt_manager_start(void);
bool mqtt_manager_is_connected(void);
esp_err_t mqtt_manager_publish_status(const char *state);

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