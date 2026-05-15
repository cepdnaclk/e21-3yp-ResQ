#ifndef ERROR_MANAGER_H
#define ERROR_MANAGER_H

#include "esp_err.h"
#include "resq_config_types.h"
#include "states.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Initialize error manager GPIO/button handling.
 */
esp_err_t error_manager_init(void);

/**
 * @brief Run ERROR state.
 *
 * ERROR state waits for BUTTON_1 press, clears saved configuration,
 * and returns RESQ_STATE_PROVISIONING.
 */
resq_state_t error_manager_run(network_config_t *network_config,
                               calibration_config_t *calibration_config,
                               const char *ip_address);

#ifdef __cplusplus
}
#endif

#endif /* ERROR_MANAGER_H */
