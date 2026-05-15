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

    config->calibrated = false;
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

    if (config->hall_baseline <= 0) {
        valid = false;
    }

    if (config->hall_delta <= 0) {
        valid = false;
    }

    if (config->hall_full_press <= 0) {
        valid = false;
    }

    if (config->ref_pressure <= 0) {
        valid = false;
    }

    if (config->bladder_1_pressure <= 0) {
        valid = false;
    }

    if (config->bladder_2_pressure <= 0) {
        valid = false;
    }

    if (config->bladder_1_full_press <= 0) {
        valid = false;
    }

    if (config->bladder_2_full_press <= 0) {
        valid = false;
    }

    config->calibrated = valid;

    return valid;
}