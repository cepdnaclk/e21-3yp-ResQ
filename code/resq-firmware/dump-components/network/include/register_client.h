#pragma once

#include <stdbool.h>

#include "esp_err.h"
#include "config_store.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    bool ok;

    char assigned_device_id[32];

    char mqtt_host[64];
    int  mqtt_port;
} register_result_t;

esp_err_t register_client_send(const device_config_t *cfg, register_result_t *out);

#ifdef __cplusplus
}
#endif