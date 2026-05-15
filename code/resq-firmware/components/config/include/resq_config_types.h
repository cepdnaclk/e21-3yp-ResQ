#ifndef RESQ_CONFIG_TYPES_H
#define RESQ_CONFIG_TYPES_H

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* =========================================================
 * Config string size limits
 *
 * These values define the maximum storage size for strings
 * saved inside the config structures and NVS.
 * ========================================================= */

#define RESQ_WIFI_SSID_MAX_LEN        32
#define RESQ_WIFI_PASS_MAX_LEN        64
#define RESQ_BACKEND_BASE_URL_MAX_LEN 128
#define RESQ_MQTT_HOST_MAX_LEN        64
#define RESQ_DEVICE_MAC_MAX_LEN       18
#define RESQ_DEVICE_ID_MAX_LEN        32

/* =========================================================
 * Network configuration
 *
 * This struct is filled during PROVISIONING.
 *
 * Flow:
 * 1. Mobile sends Wi-Fi + LocalHub + MQTT details.
 * 2. Firmware fills this structure.
 * 3. Firmware validates it.
 * 4. If valid, provisioned becomes true.
 * 5. Config is saved to NVS.
 * 6. BOOT later loads this config from NVS.
 * ========================================================= */

typedef struct
{
    char wifi_ssid[RESQ_WIFI_SSID_MAX_LEN];
    char wifi_pass[RESQ_WIFI_PASS_MAX_LEN];

    char backend_base_url[RESQ_BACKEND_BASE_URL_MAX_LEN];

    bool provisioned;

} network_config_t;

/* =========================================================
 * Calibration configuration
 *
 * This struct is filled during CALIBRATING.
 *
 * Flow:
 * 1. Firmware reads reference pressure.
 * 2. Firmware reads Hall baseline.
 * 3. Instructor compresses chest to full target depth.
 * 4. Firmware captures Hall delta and full-press values.
 * 5. Firmware validates this structure.
 * 6. If valid, calibrated becomes true.
 * 7. Config is saved to NVS.
 * ========================================================= */

typedef struct
{
    int32_t hall_baseline;          // measured by firmware at rest position
    int32_t hall_delta;             // received from LocalHub
    int32_t hall_full_press;        // calculated by firmware: hall_baseline - hall_delta

    int32_t ref_pressure;           // received from LocalHub, checked using sensor 0

    int32_t bladder_1_pressure;     // received from LocalHub
    int32_t bladder_2_pressure;     // received from LocalHub

    int32_t bladder_1_full_press;   // measured by firmware at full compression
    int32_t bladder_2_full_press;   // measured by firmware at full compression

    bool calibrated;                // becomes true if all values are valid and present

} calibration_config_t;

/**
 * @brief Reset network config to empty safe values.
 *
 * mqtt_port is set to 0 because there is no default MQTT port.
 * It must be received from provisioning.
 */
void network_config_set_defaults(network_config_t *config);

/**
 * @brief Reset calibration config to empty safe values.
 */
void calibration_config_set_defaults(calibration_config_t *config);

/**
 * @brief Validate network config.
 *
 * If valid:
 *   config->provisioned = true
 *
 * If invalid:
 *   config->provisioned = false
 */
bool network_config_validate(network_config_t *config);

/**
 * @brief Validate calibration config.
 *
 * If valid:
 *   config->calibrated = true
 *
 * If invalid:
 *   config->calibrated = false
 */
bool calibration_config_validate(calibration_config_t *config);

#ifdef __cplusplus
}
#endif

#endif /* RESQ_CONFIG_TYPES_H */