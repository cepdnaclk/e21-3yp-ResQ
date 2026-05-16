#ifndef CALIBRATION_FAIL_MANAGER_H
#define CALIBRATION_FAIL_MANAGER_H

#include "esp_err.h"
#include "states.h"
#include "resq_config_types.h"

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t calibration_fail_manager_init(void);

resq_state_t calibration_fail_manager_run(network_config_t *network_config,
                                          calibration_config_t *calibration_config,
                                          const char *ip_address);

#ifdef __cplusplus
}
#endif

#endif
