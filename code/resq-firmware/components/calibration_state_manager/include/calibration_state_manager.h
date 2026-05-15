#ifndef CALIBRATION_STATE_MANAGER_H
#define CALIBRATION_STATE_MANAGER_H

#include "states.h"
#include "resq_config_types.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Run the CALIBRATING state.
 *
 * This function assumes calibration_manager_start() has already been called,
 * or it may start calibration if the implementation requires that.
 *
 * It waits for the automatic calibration task to finish and returns the next
 * firmware state.
 *
 * Possible return values:
 * - RESQ_STATE_READY_FOR_SESSION
 * - RESQ_STATE_CALIBRATION_FAIL
 * - RESQ_STATE_PAIRED_IDLE
 * - RESQ_STATE_ERROR
 */
resq_state_t calibration_state_manager_run(network_config_t *network_config,
                                           calibration_config_t *calibration_config,
                                           const char *ip_address);

#ifdef __cplusplus
}
#endif

#endif /* CALIBRATION_STATE_MANAGER_H */
