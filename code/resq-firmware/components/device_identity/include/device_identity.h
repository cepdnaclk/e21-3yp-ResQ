#pragma once

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    char device_id[32];
    char manikin_id[32];

    char firmware_version[32];
    char hardware_revision[32];
    char build_date[24];
    char build_time[24];

    char chip_model[32];
    int  chip_cores;
    int  chip_revision;

    char mac_address[18];
    int  reset_reason;
} device_identity_info_t;

esp_err_t device_identity_init(const char *device_id, const char *manikin_id);
esp_err_t device_identity_get(device_identity_info_t *out);

#ifdef __cplusplus
}
#endif