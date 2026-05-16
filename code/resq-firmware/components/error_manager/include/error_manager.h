#ifndef ERROR_MANAGER_H
#define ERROR_MANAGER_H

#include "esp_err.h"
#include "resq_config_types.h"
#include "states.h"
#include "error_codes.h"

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

/* New public APIs */
esp_err_t error_manager_set_error(firmware_error_reason_id_t reason_id);

firmware_error_reason_id_t error_manager_get_last_reason(void);

firmware_error_action_id_t error_manager_get_last_action(void);

esp_err_t error_manager_publish_error_event(const network_config_t *network_config,
                                            firmware_error_reason_id_t reason_id,
                                            resq_state_t state,
                                            firmware_error_action_id_t action_id);

resq_state_t error_manager_get_retry_state(void);

#ifdef __cplusplus
}
#endif

#endif /* ERROR_MANAGER_H */
