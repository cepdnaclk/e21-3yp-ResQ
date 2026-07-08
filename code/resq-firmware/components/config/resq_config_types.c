#include "resq_config_types.h"

#include <string.h>

/**
 * @brief Reset network config to safe defaults.
 */
void network_config_set_defaults(network_config_t *config)
{
    if (config == NULL) {
        return;
    }

    memset(config, 0, sizeof(network_config_t));

    config->provisioned = false;
}

/**
 * @brief Reset calibration config to safe defaults.
 */
void calibration_config_set_defaults(calibration_config_t *config)
{
    if (config == NULL) {
        return;
    }

    memset(config, 0, sizeof(calibration_config_t));

    /* Preserve explicit safe defaults for new adaptive fields */
    config->calibrated = false;
    config->hall_direction = 0;
    config->pressure_balance_allowed_pct = 25; /* default 25% */
    config->pressure_mode = CALIBRATION_PRESSURE_OPTIONAL;
    config->pressure_degraded = false;
    config->using_last_stable_pressure = false;
    config->pressure_valid = true;
    config->hall_valid = false;
    config->pressure_0_kpa_per_count = 0.0f;
    config->pressure_1_kpa_per_count = 0.0f;
    config->pressure_2_kpa_per_count = 0.0f;
    config->full_depth_mm = 0.0f;
    config->calibration_sample_count = 60;
    config->calibration_window_ms = 2000;
    config->calibrated_at_ms = 0;
}

/**
 * @brief Validate network configuration.
 *
 * This function also updates config->provisioned.
 */
bool network_config_validate(network_config_t *config)
{
    if (config == NULL) {
        return false;
    }

    bool valid = true;

    if (config->wifi_ssid[0] == '\0') {
        valid = false;
    }
    if (config->backend_base_url[0] == '\0') {
        valid = false;
    }

    /* Backend/device MAC are runtime values and are not required
     * for validation of the persisted network configuration.
     */

    config->provisioned = valid;

    return valid;
}

/**
 * @brief Validate calibration configuration.
 *
 * This function also updates config->calibrated.
 */
bool calibration_config_validate(calibration_config_t *config)
{
    if (config == NULL) {
        return false;
    }

    bool valid = true;

    const int32_t MIN_HALL_RANGE = 30;
    const int32_t MIN_PRESSURE_RANGE = 300;

    if (config->hall_baseline <= 0) {
        valid = false;
    }

    if (config->hall_full_press <= 0) {
        valid = false;
    }

    /* derived/collected hall range */
    if (config->hall_range_raw <= MIN_HALL_RANGE) {
        valid = false;
    }

    if (!(config->hall_direction == 1 || config->hall_direction == -1)) {
        valid = false;
    }

    if (config->hall_start_delta <= 0) {
        valid = false;
    }

    if (config->hall_full_delta_threshold <= config->hall_start_delta) {
        valid = false;
    }

    if (config->hall_recoil_delta <= 0) {
        valid = false;
    }

    if (config->ref_pressure <= 0) {
        valid = false;
    }

    if (config->bladder_1_pressure <= 0 || config->bladder_2_pressure <= 0) {
        valid = false;
    }

    bool pressure_required = config->pressure_mode == CALIBRATION_PRESSURE_REQUIRED;
    bool pressure_usable = pressure_required || config->pressure_valid;

    if (pressure_usable && (config->bladder_1_full_press <= 0 || config->bladder_2_full_press <= 0)) {
        valid = false;
    }

    if (pressure_usable && (config->pressure_1_range_raw <= MIN_PRESSURE_RANGE || config->pressure_2_range_raw <= MIN_PRESSURE_RANGE)) {
        valid = false;
    }

    if (pressure_usable && config->pressure_contact_threshold <= 0) {
        valid = false;
    }

    if (pressure_usable && config->pressure_valid_threshold <= config->pressure_contact_threshold) {
        valid = false;
    }

    if (config->pressure_balance_allowed_pct < 5 || config->pressure_balance_allowed_pct > 60) {
        valid = false;
    }

    if (config->calibrated && config->calibrated_at_ms <= 0) {
        valid = false;
    }

    config->calibrated = valid;

    return valid;
}
