#pragma once

#include "esp_err.h"
#include "config_store.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    DEVICE_ACTION_NONE = 0,
    DEVICE_ACTION_REBOOT,
    DEVICE_ACTION_UNPAIR_REBOOT,
} device_action_t;

esp_err_t device_control_init(const device_config_t *cfg);
esp_err_t device_control_request_reboot(void);
esp_err_t device_control_request_unpair(void);

/* Split config update into validate + save */
esp_err_t device_control_validate_config_update(const device_config_t *new_cfg);
esp_err_t device_control_save_config_update(const device_config_t *new_cfg);

device_action_t device_control_get_pending_action(void);
void device_control_clear_pending_action(void);

#ifdef __cplusplus
}
#endif