#pragma once

#include "esp_err.h"
#include "config_store.h"

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t recovery_manager_init(const device_config_t *cfg);
esp_err_t recovery_manager_start(void);

#ifdef __cplusplus
}
#endif