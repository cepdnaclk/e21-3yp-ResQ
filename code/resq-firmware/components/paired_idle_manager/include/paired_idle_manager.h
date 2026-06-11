#ifndef PAIRED_IDLE_MANAGER_H
#define PAIRED_IDLE_MANAGER_H

#include "esp_err.h"

#include "resq_config_types.h"
#include "states.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Initialize paired idle manager.
 */
esp_err_t paired_idle_manager_init(void);

/**
 * @brief Run the PAIRED_IDLE state.
 *
 * This function blocks/polls until a state transition is needed.
 *
 * Rules:
 * - calibrated == true        -> READY_FOR_SESSION
 * - cmd/debug success         -> stay PAIRED_IDLE
 * - cmd/calibration/start OK  -> CALIBRATING
 * - any error                 -> ERROR
 */
resq_state_t paired_idle_manager_run(network_config_t *network_config,
                                     calibration_config_t *calibration_config,
                                     const char *ip_address);

#ifdef __cplusplus
}
#endif

#endif /* PAIRED_IDLE_MANAGER_H */
