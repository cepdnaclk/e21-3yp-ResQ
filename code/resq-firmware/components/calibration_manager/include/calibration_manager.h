#ifndef CALIBRATION_MANAGER_H
#define CALIBRATION_MANAGER_H

#include <stdbool.h>

#include "esp_err.h"
#include "resq_config_types.h"
#include "calibration_codes.h"
#include "states.h"

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
/* Percentage of expected hall range required to consider full-press (prototype tuning) */
#define CALIBRATION_FULL_PRESS_RATIO_PCT        60

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

/* Store and retrieve the request_id associated with the running calibration.
 * The request_id is the LocalHub-provided identifier used as reply_id in events.
 */
void calibration_manager_set_request_id(const char *request_id);
const char *calibration_manager_get_request_id(void);

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

/* New APIs for calibration failure handling and retry */
calibration_reason_id_t calibration_manager_get_last_failure_reason(void);

calibration_action_id_t calibration_manager_get_last_failure_action(void);

esp_err_t calibration_manager_get_last_host_params(calibration_config_t *out_config);

esp_err_t calibration_manager_drop_temporary_values(void);

esp_err_t calibration_manager_retry_last(network_config_t *network_config);

esp_err_t calibration_manager_publish_progress_event(calibration_reason_id_t reason_id,
													 resq_state_t state,
													 calibration_action_id_t action_id);

/**
 * @brief Publish a calibration result event to `events/calibration`.
 * This emits `event_id` 4000 for in-progress or 4002 for final results.
 */
esp_err_t calibration_manager_publish_calibration_result(const char *reply_id,
														const char *status,
														const char *result,
														calibration_reason_id_t reason_id,
														resq_state_t state,
														calibration_action_id_t action_id);

/* Parse a calibration_start payload into a calibration_config_t.
 * Returns ESP_OK on success and fills out_config and out_command_id.
 * On failure returns an esp_err_t and sets out_reason (if provided) to the numeric reason.
 */
esp_err_t calibration_manager_parse_start_payload(const char *payload,
												  calibration_config_t *out_config,
												  char *out_command_id,
												  size_t out_command_id_len,
												  calibration_reason_id_t *out_reason);

#ifdef __cplusplus
}
#endif

#endif /* CALIBRATION_MANAGER_H */
