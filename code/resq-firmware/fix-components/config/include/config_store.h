#ifndef CONFIG_STORE_H
#define CONFIG_STORE_H

#include <stddef.h>

#include "esp_err.h"
#include "resq_config_types.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Initialize NVS flash storage.
 *
 * Call once during BOOT before loading or saving config.
 */
esp_err_t config_store_init(void);

/**
 * @brief Read ESP hardware MAC and write it as a string.
 *
 * Output format:
 * AA:BB:CC:DD:EE:FF
 */
esp_err_t config_store_get_device_mac(char *buffer, size_t buffer_len);

/**
 * @brief Read ESP hardware MAC and place it into network_config_t.
 *
 * This prevents mobile provisioning from spoofing or changing device_mac.
 */
esp_err_t config_store_apply_device_mac(network_config_t *config);

/**
 * @brief Load network config from NVS.
 *
 * This also refreshes config->device_mac from ESP hardware MAC.
 */
esp_err_t config_store_load_network(network_config_t *config);

/**
 * @brief Save network config to NVS.
 *
 * This also overwrites config->device_mac with ESP hardware MAC before saving.
 */
esp_err_t config_store_save_network(network_config_t *config);

/**
 * @brief Load calibration config from NVS.
 */
esp_err_t config_store_load_calibration(calibration_config_t *config);

/**
 * @brief Save calibration config to NVS.
 */
esp_err_t config_store_save_calibration(const calibration_config_t *config);

/**
 * @brief Clear only network/provisioning values.
 *
 * Important:
 * This does NOT erase device_mac.
 */
esp_err_t config_store_clear_network(void);

/**
 * @brief Clear only calibration values.
 */
esp_err_t config_store_clear_calibration(void);

/**
 * @brief Clear network and calibration values.
 *
 * Important:
 * This does NOT erase device_mac.
 */
esp_err_t config_store_clear_all(void);

#ifdef __cplusplus
}
#endif

#endif /* CONFIG_STORE_H */