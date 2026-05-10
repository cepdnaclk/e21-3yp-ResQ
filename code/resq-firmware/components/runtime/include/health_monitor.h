#pragma once

#include "esp_err.h"
#include "config_store.h"

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t health_monitor_init(const device_config_t *cfg);
esp_err_t health_monitor_start(void);
esp_err_t health_monitor_publish_now(void);

#ifdef __cplusplus
}
#endif