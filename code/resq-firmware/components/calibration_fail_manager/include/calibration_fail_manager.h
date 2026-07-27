#ifndef CALIBRATION_FAIL_MANAGER_H
#define CALIBRATION_FAIL_MANAGER_H

#include "esp_err.h"
#include "states.h"
#include "resq_config_types.h"
#include "system_button_manager.h"

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t calibration_fail_manager_init(void);

/** Pure fail-state button mapping; unrelated inputs remain in fail state. */
resq_state_t calibration_fail_manager_state_for_button(
    const system_button_event_t *event);

resq_state_t calibration_fail_manager_run(network_config_t *network_config,
                                          calibration_config_t *calibration_config,
                                          const char *ip_address);

#ifdef __cplusplus
}
#endif

#endif
