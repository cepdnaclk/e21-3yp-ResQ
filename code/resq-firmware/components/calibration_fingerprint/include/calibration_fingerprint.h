#ifndef CALIBRATION_FINGERPRINT_H
#define CALIBRATION_FINGERPRINT_H

#include <stdint.h>
#include <stddef.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Calculate canonical SHA-256 fingerprint for a calibration profile.
 *
 * Format:
 * profile_id={id};profile_version={version};hall_delta={hall};ref_pressure={ref};bladder_1_pressure={b1};bladder_2_pressure={b2}
 *
 * @param profile_id The unique identifier of the calibration profile.
 * @param profile_version The version of the profile (base-10 integer).
 * @param hall_delta The expected hall delta target.
 * @param ref_pressure Reference pressure target.
 * @param bladder_1_pressure Bladder 1 pressure target.
 * @param bladder_2_pressure Bladder 2 pressure target.
 * @param out_hash Pointer to buffer where hex string will be written (min 65 bytes).
 * @param max_len Size of out_hash buffer.
 * @return esp_err_t ESP_OK on success, ESP_ERR_INVALID_ARG on validation/buffer limits.
 */
esp_err_t calibration_fingerprint_calculate(
    const char *profile_id,
    uint32_t profile_version,
    int32_t hall_delta,
    int32_t ref_pressure,
    int32_t bladder_1_pressure,
    int32_t bladder_2_pressure,
    char *out_hash,
    size_t max_len
);

#ifdef __cplusplus
}
#endif

#endif // CALIBRATION_FINGERPRINT_H
