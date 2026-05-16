#ifndef SYSTEM_BUTTON_MANAGER_H
#define SYSTEM_BUTTON_MANAGER_H

#include "esp_err.h"
#include "states.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    SYSTEM_BUTTON_ACTION_NONE = 0,
    SYSTEM_BUTTON_ACTION_TURN_OFF,
    SYSTEM_BUTTON_ACTION_FACTORY_RESET
} system_button_action_t;

esp_err_t system_button_manager_init(void);

system_button_action_t system_button_manager_poll(resq_state_t current_state);

#ifdef __cplusplus
}
#endif

#endif
