#pragma once

#include <stdbool.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

#define CONFIG_STR_SMALL   32
#define CONFIG_STR_MEDIUM  64
#define CONFIG_STR_LARGE  128

/**
 * @brief Persistent device configuration stored in NVS.
 *
 * This is the configuration that future provisioning will save and
 * future networking/runtime modules will use.
 */
typedef struct {
    char wifi_ssid[CONFIG_STR_SMALL];
    char wifi_pass[CONFIG_STR_MEDIUM];

    char register_url[CONFIG_STR_LARGE];

    char mqtt_host[CONFIG_STR_MEDIUM];
    int  mqtt_port;

    char device_id[CONFIG_STR_SMALL];
    char manikin_id[CONFIG_STR_SMALL];

    char auth_token[CONFIG_STR_MEDIUM];

    bool provisioned;

    /* -----------------------------
     * Calibration / runtime settings
     * ----------------------------- */
    int hall_baseline;
    int hall_min_delta;
    int hall_max_delta;
    int compression_start_delta;
    int sensor_sample_interval_ms;
    
} device_config_t;

/**
 * @brief Initialize NVS flash.
 */
esp_err_t config_store_init(void);

/**
 * @brief Load configuration from NVS into caller-provided struct.
 *
 * If fields do not exist yet, they are returned as empty/default values.
 */
esp_err_t config_store_load(device_config_t *cfg);

/**
 * @brief Save configuration to NVS.
 */
esp_err_t config_store_save(const device_config_t *cfg);

/**
 * @brief Clear all configuration from the config namespace.
 */
esp_err_t config_store_clear(void);

/**
 * @brief Fast check for provisioned state.
 */
bool config_store_is_provisioned(void);

#ifdef __cplusplus
}
#endif