#ifndef CONFIG_STORE_H
#define CONFIG_STORE_H

#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>

#include "esp_err.h"
#include "resq_config_types.h"

#ifdef __cplusplus
extern "C" {
#endif

#define CALIBRATION_PROFILE_HASH_BYTES 64

typedef enum {
    CAL_STORE_VALID = 0,
    CAL_STORE_NOT_FOUND,
    CAL_STORE_CORRUPT,
    CAL_STORE_UNSUPPORTED_SCHEMA,
    CAL_STORE_IO_ERROR,
    CAL_STORE_COMMIT_VERIFICATION_FAILED,
    CAL_STORE_GENERATION_EXHAUSTED,
    CAL_STORE_PROFILE_HASH_MISMATCH
} cal_store_outcome_t;

typedef struct {
    char     calibration_storage_status[CALIBRATION_STORAGE_STATUS_MAX_LEN]; // "VALID","MISSING","CORRUPT","UNSUPPORTED_SCHEMA","LEGACY_UNVERIFIED","UNKNOWN","COMMIT_VERIFICATION_FAILED"
    uint32_t schema_version;                 // Represents CALIBRATION_RECORD_SCHEMA_VERSION, NOT envelope schema
    uint32_t generation;
    uint8_t  recalibration_required;         // uint8_t, not bool
    uint8_t  committed_record_valid;         // 1 = committed record exists and is valid, 0 = otherwise
    char     profile_id[32];                 // Matches runtime struct capacity
    uint32_t profile_version;
    char     profile_hash[CALIBRATION_PROFILE_HASH_BYTES + 1];
    // Candidate fields for diagnostics when recalibration is in progress (Correction 11)
    char     candidate_profile_id[32];
    uint32_t candidate_profile_version;
    char     candidate_profile_hash[CALIBRATION_PROFILE_HASH_BYTES + 1];
} calibration_store_snapshot_t;

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
 * @brief Promote candidate calibration to committed active calibration in NVS.
 */
cal_store_outcome_t config_store_promote_calibration(
    const calibration_config_t *candidate,
    calibration_config_t *out_committed,
    calibration_store_snapshot_t *out_snapshot
);

/**
 * @brief Set the recalibration_required flag in NVS.
 */
esp_err_t config_store_mark_recalibration_required(void);

/**
 * @brief Get the recalibration_required flag in NVS.
 */
esp_err_t config_store_get_recalibration_required(bool *out);

/**
 * @brief Get calibration store snapshot.
 */
cal_store_outcome_t config_store_get_snapshot(calibration_store_snapshot_t *out);

/**
 * @brief Set current candidate profile fields (RAM diagnostics only).
 */
void config_store_set_candidate_profile(const char *profile_id, uint32_t version, const char *hash);

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
 */
esp_err_t config_store_clear_all(void);

#ifdef __cplusplus
}
#endif

#endif /* CONFIG_STORE_H */