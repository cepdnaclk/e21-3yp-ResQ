#pragma once

#include <stdbool.h>

#include "esp_err.h"
#include "freertos/FreeRTOS.h"
#include "config_store.h"

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t factory_reset_init(void);
bool factory_reset_button_held(TickType_t hold_time_ticks);
bool factory_reset_config_valid(const device_config_t *cfg);

#ifdef __cplusplus
}
#endif