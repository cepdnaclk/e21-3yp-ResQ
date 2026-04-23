#pragma once

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    INDICATOR_STATE_OFF = 0,
    INDICATOR_STATE_PROVISIONING,
    INDICATOR_STATE_WIFI_CONNECTING,
    INDICATOR_STATE_ONLINE_IDLE,
    INDICATOR_STATE_SESSION_ACTIVE,
    INDICATOR_STATE_FAULT,
    INDICATOR_STATE_RESETTING,
} indicator_state_t;

esp_err_t status_indicator_init(void);
esp_err_t status_indicator_start(void);
void status_indicator_set(indicator_state_t state);

#ifdef __cplusplus
}
#endif