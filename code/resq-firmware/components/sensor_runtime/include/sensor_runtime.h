#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"
#include "cpr_logic.h"
#include "config_store.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    int32_t force1;
    int32_t force2;

    bool force1_ok;
    bool force2_ok;
    bool hall_ok;

    int hall_raw;
    int current_delta;

    int total_compressions;
    cpr_feedback_t feedback;
} sensor_snapshot_t;

esp_err_t sensor_runtime_init(const device_config_t *cfg);
esp_err_t sensor_runtime_apply_config(const device_config_t *cfg);
esp_err_t sensor_runtime_start(void);
esp_err_t sensor_runtime_stop(void);
bool sensor_runtime_is_running(void);
esp_err_t sensor_runtime_reset_session_data(void);
esp_err_t sensor_runtime_get_latest(sensor_snapshot_t *out);

#ifdef __cplusplus
}
#endif