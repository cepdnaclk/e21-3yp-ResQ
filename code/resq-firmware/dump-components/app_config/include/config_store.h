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

    // Calibration profile identity
    char calibration_profile_id[CONFIG_STR_SMALL];

    // Base reference pressure expected at rest
    int force1_base_reference;
    int force2_base_reference;
    int force_base_tolerance_pct;

    // Normal/rest position validation
    int normal_hall_tolerance;
    int normal_pressure_tolerance;

    // Full compression depth mapping
    int full_depth_target_mm;
    int full_depth_hall_delta;
    int full_depth_tolerance_pct;

    // Recoil and hand placement
    int recoil_return_threshold_delta;
    int max_pressure_imbalance_pct;

    // Calibration timing
    int calibration_window_ms;

    // Behavior flags
    bool calibration_required;
    bool debug_raw_enabled;   
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

bool config_store_calibration_values_valid(const device_config_t *cfg);

/**
 * @brief Clear only provisioning-related configuration from NVS.
 *
 * This removes stored Wi-Fi SSID/password and clears provisioning-related
 * network fields (register URL, MQTT host/port) while preserving device
 * identity and calibration/runtime tuning values. It also sets the
 * provisioned flag to false and commits changes.
 */
esp_err_t config_store_clear_wifi_provisioning(void);

#ifdef __cplusplus
}
#endif