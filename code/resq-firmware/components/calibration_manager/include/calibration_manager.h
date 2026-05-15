#ifndef CALIBRATION_MANAGER_H
#define CALIBRATION_MANAGER_H

#include <stdbool.h>

#include "esp_err.h"
#include "resq_config_types.h"

#ifdef __cplusplus
extern "C" {
#endif

/* =========================================================
 * Calibration tolerance values
 *
 * Exact equality is not safe for real sensors.
 * So we check whether the sensor reading is inside a tolerance range.
 * ========================================================= */

#define CALIBRATION_PRESSURE_TOLERANCE_RAW      100
#define CALIBRATION_HALL_TOLERANCE_RAW          20
#define CALIBRATION_AVERAGE_SAMPLE_COUNT        5

/* =========================================================
 * Public API
 * ========================================================= */

/**
 * @brief Initialize calibration manager and sensors needed for calibration.
 *
 * Call once during BOOT after config_store_init().
 */
esp_err_t calibration_manager_init(void);

/**
 * @brief Start calibration using basic parameters received from LocalHub.
 *
 * LocalHub must provide:
 * - ref_pressure
 * - bladder_1_pressure
 * - bladder_2_pressure
 * - hall_delta
 *
 * Firmware will measure:
 * - hall_baseline
 * - hall_full_press
 * - bladder_1_full_press
 * - bladder_2_full_press
 */
esp_err_t calibration_manager_start(const network_config_t *network_config,
									const calibration_config_t *host_params,
									const char *command_id);

/**
 * @brief Cancel active calibration.
 */
esp_err_t calibration_manager_cancel(void);

/**
 * @brief Check whether calibration task is currently running.
 */
bool calibration_manager_is_running(void);

/**
 * @brief Check whether latest calibration is valid and ready.
 */
bool calibration_manager_is_ready(void);

/**
 * @brief Copy latest calibration config.
 */
esp_err_t calibration_manager_get_config(calibration_config_t *out_config);

/**
 * @brief Get the command_id associated with the currently running calibration.
 *
 * Returns empty string if no calibration in progress.
 */
const char *calibration_manager_get_command_id(void);

#ifdef __cplusplus
}
#endif

#endif /* CALIBRATION_MANAGER_H */