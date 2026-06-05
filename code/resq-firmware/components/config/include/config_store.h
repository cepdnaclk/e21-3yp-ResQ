#ifndef CONFIG_STORE_H
#define CONFIG_STORE_H

#include <stddef.h>
#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"
#include "resq_config_types.h"

#ifdef __cplusplus
extern "C" {
#endif

#define RESQ_OTA_RESULT_MAX_LEN 16
#define RESQ_OTA_VERSION_MAX_LEN 32
#define RESQ_OTA_PHASE_MAX_LEN 24

typedef struct
{
    bool force_provisioning;
    char last_result[RESQ_OTA_RESULT_MAX_LEN];
    char last_version[RESQ_OTA_VERSION_MAX_LEN];
    int32_t last_error_id;
    int32_t last_bytes_written;
    char last_failed_phase[RESQ_OTA_PHASE_MAX_LEN];
} ota_metadata_t;

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
 * @brief Load network config from NVS.
 */
esp_err_t config_store_load_network(network_config_t *config);

/**
 * @brief Save network config to NVS.
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
 * @brief Load OTA metadata that must survive reboot.
 */
esp_err_t config_store_load_ota_metadata(ota_metadata_t *metadata);

/**
 * @brief Save OTA result metadata and the post-reboot provisioning flag.
 */
esp_err_t config_store_save_ota_metadata(const ota_metadata_t *metadata);

/**
 * @brief Read and clear the one-shot force-provisioning flag.
 */
esp_err_t config_store_take_force_provisioning(bool *force_provisioning);

/**
 * @brief Clear OTA metadata.
 */
esp_err_t config_store_clear_ota_metadata(void);


/**
 * @brief Clear only network/provisioning values.
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
