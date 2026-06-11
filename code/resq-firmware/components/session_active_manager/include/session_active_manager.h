#ifndef SESSION_ACTIVE_MANAGER_H
#define SESSION_ACTIVE_MANAGER_H

#include <stdbool.h>

#include "esp_err.h"
#include "states.h"
#include "resq_config_types.h"
#include "mqtt_manager.h"

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t session_active_manager_init(void);

resq_state_t session_active_manager_start(network_config_t *network_config,
                                          calibration_config_t *calibration_config,
                                          const char *ip_address,
                                          const char *session_id,
                                          const char *profile_id,
                                          const resq_mqtt_command_t *cmd);

resq_state_t session_active_manager_run(network_config_t *network_config,
                                        calibration_config_t *calibration_config,
                                        const char *ip_address);

bool session_active_manager_is_sensor_running(void);

bool session_active_manager_has_pending_interruption(void);

esp_err_t session_active_manager_publish_pending_interruption(
    network_config_t *network_config,
    calibration_config_t *calibration_config,
    const char *ip_address);

#ifdef __cplusplus
}
#endif

#endif
