#ifndef CALIBRATION_MANAGER_H
#define CALIBRATION_MANAGER_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "calibration_codes.h"
#include "esp_err.h"
#include "resq_config_types.h"
#include "sensor_runtime_status.h"
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

#define CALIBRATION_PRESSURE_TOLERANCE_RAW 100
#define CALIBRATION_HALL_TOLERANCE_RAW 20
#define CALIBRATION_HALL_DELTA_MIN_RAW 50
#define CALIBRATION_HALL_ADC_MAX_RAW 4095
#define CALIBRATION_HALL_DELTA_MAX_ADC_COUNTS CALIBRATION_HALL_ADC_MAX_RAW
/* Lower threshold for detecting that compression started; final validation
 * uses
 * tolerance. */
#define CALIBRATION_FULL_PRESS_START_RATIO_PCT 15
#define CALIBRATION_FULL_PRESS_CANDIDATE_RATIO_PCT 85
#define CALIBRATION_PRESSURE_TARGET_TOLERANCE_PCT 8
#define CALIBRATION_PRESSURE_TARGET_MIN_TOLERANCE_RAW 100
#define CALIBRATION_PRESSURE_TARGET_CONSECUTIVE_MATCHES 3U
#define CALIBRATION_PRESSURE_TARGET_HOLD_MS 250

typedef enum {
    CALIBRATION_ATTEMPT_NONE = 0,
    CALIBRATION_ATTEMPT_RUNNING,
    CALIBRATION_ATTEMPT_PASS,
    CALIBRATION_ATTEMPT_FAIL,
    CALIBRATION_ATTEMPT_CANCELLED,
    CALIBRATION_ATTEMPT_INTERNAL_ERROR
} calibration_attempt_result_t;

/**
 * Commit the first terminal result for an attempt.
 *
 * The caller owns synchronization for shared state.
 */
bool calibration_manager_attempt_result_try_finalize(
    calibration_attempt_result_t *current,
    calibration_attempt_result_t terminal_result);

typedef struct {
    int32_t value;
    bool read_ok;
    bool fresh;
    bool channel_valid;
    bool saturated;
    bool stale;
    bool using_last_stable;
    int64_t timestamp_ms;
} calibration_pressure_target_sample_t;

typedef struct {
    unsigned consecutive_matches;
    int64_t first_match_timestamp_ms;
} calibration_pressure_target_tracker_t;

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
 * - hall_delta
 * - ref_pressure, bladder_1_pressure,
 * and bladder_2_pressure when pressure
 *   mode is required
 * Firmware will
 * measure:
 * - hall_baseline
 * - hall_full_press
 * - bladder_1_full_press
 * - bladder_2_full_press
 */
esp_err_t calibration_manager_start(const network_config_t *network_config,
                                    const calibration_config_t *host_params,
                                    const char *command_id);

/* Store and retrieve the request_id associated with the running calibration.
 * The request_id is the LocalHub-provided identifier used as reply_id in
 * events.
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

/** Copy the calibration task's runtime-only sensor-health snapshot. */
esp_err_t calibration_manager_get_runtime_health(
    sensor_runtime_health_t *out_health);

/**
 * @brief Get the command_id associated with the currently running calibration.
 *
 * Returns empty string if no calibration in progress.
 */
const char *calibration_manager_get_command_id(void);

/* New APIs for calibration failure handling and retry */
calibration_reason_id_t calibration_manager_get_last_failure_reason(void);

calibration_action_id_t calibration_manager_get_last_failure_action(void);

esp_err_t
calibration_manager_get_last_host_params(calibration_config_t *out_config);

esp_err_t calibration_manager_drop_temporary_values(void);

esp_err_t calibration_manager_retry_last(network_config_t *network_config);

esp_err_t calibration_manager_publish_progress_event(
    calibration_reason_id_t reason_id, resq_state_t state,
    calibration_action_id_t action_id, int progress_id);

/**
 * @brief Publish a calibration result event to `events/calibration`.
 * This emits `event_id` 4000 for in-progress or 4002 for final results.
 */
esp_err_t calibration_manager_publish_calibration_result(
    const char *reply_id, const char *status, const char *result,
    calibration_reason_id_t reason_id, resq_state_t state,
    calibration_action_id_t action_id);

/* Parse a calibration_start payload into a calibration_config_t.
 * Returns ESP_OK on success and fills out_config and out_command_id.
 * On failure returns an esp_err_t and sets out_reason (if provided) to the
 * numeric reason.
 */
esp_err_t calibration_manager_parse_start_payload(
    const char *payload, calibration_config_t *out_config, char *out_command_id,
    size_t out_command_id_len, calibration_reason_id_t *out_reason);

esp_err_t calibration_manager_try_reserve_session_start(
    const char *profile_id,
    uint32_t profile_version,
    const char *profile_hash);
esp_err_t calibration_manager_notify_session_started(void);
esp_err_t calibration_manager_rollback_session_start(void);
esp_err_t calibration_manager_notify_session_ended(void);

/**
 * Physical pressure acquisition is disabled only by an explicit Hall-only
 * request. A degraded decision state never disables later recovery attempts.
 */
bool calibration_manager_pressure_acquisition_enabled(
    calibration_pressure_mode_t mode);

/** Validate only the pressure channels required by the current stage. */
bool calibration_manager_pressure_stage_masks_valid(
    uint8_t read_valid_mask,
    uint8_t saturation_mask,
    uint8_t required_mask);

/** True for every calibration policy that requests physical pressure stages. */
bool calibration_manager_pressure_targets_required(
    calibration_pressure_mode_t mode);

/** Strict, overflow-safe target window used by target and baseline stages. */
int32_t calibration_manager_pressure_target_tolerance(int32_t target);
bool calibration_manager_value_within_target(
    int32_t value,
    int32_t target,
    int32_t tolerance);

/** Pure target-hold helpers shared by the worker and Unity tests. */
bool calibration_manager_pressure_target_sample_usable(
    const calibration_pressure_target_sample_t *sample);
void calibration_manager_pressure_target_tracker_reset(
    calibration_pressure_target_tracker_t *tracker);
bool calibration_manager_pressure_target_tracker_observe(
    calibration_pressure_target_tracker_t *tracker,
    const calibration_pressure_target_sample_t *sample,
    int32_t target,
    int32_t tolerance,
    unsigned required_matches,
    int64_t required_hold_ms);

/** Result of the most recently started attempt, independent of saved config. */
calibration_attempt_result_t
calibration_manager_get_last_attempt_result(void);

#ifdef __cplusplus
}
#endif

#endif /* CALIBRATION_MANAGER_H */
