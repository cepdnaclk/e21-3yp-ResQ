#pragma once

#include "esp_err.h"
#include "config_store.h"

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t command_handler_init(const device_config_t *cfg);
esp_err_t command_handler_handle_message(const char *suffix, const char *payload);
esp_err_t command_handler_reject_message(const char *suffix, const char *reason);

#ifdef __cplusplus
}
#endif
