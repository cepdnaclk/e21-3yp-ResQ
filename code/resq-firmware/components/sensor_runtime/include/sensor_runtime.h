#pragma once

#include <stdbool.h>


#include "esp_err.h"
#include "cpr_logic.h"
#include "config_store.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    SENSOR_MODE_IDLE = 0,
    SENSOR_MODE_CALIBRATION,
    SENSOR_MODE_SESSION
} sensor_mode_t;

typedef struct {
    uint64_t ts_ms;
    sensor_mode_t mode;

    int32_t force1;
    int32_t force2;
    bool force1_ok;
    bool force2_ok;

    bool hall_ok;
    int32_t hall_raw;
    int32_t hall_filtered;
    int32_t current_delta;

    int32_t total_compressions;

    float depth_mm;
    float rate_cpm;
    float pause_s;

    bool recoil_ok;
    bool depth_ok;
    bool rate_ok;
    bool hand_ok;

    const char *hand_placement;
    uint32_t flags;

    cpr_feedback_t feedback;
} sensor_snapshot_t;

esp_err_t sensor_runtime_init(const device_config_t *cfg);
esp_err_t sensor_runtime_apply_config(const device_config_t *cfg);
esp_err_t sensor_runtime_start(sensor_mode_t mode);
esp_err_t sensor_runtime_stop(void);
bool sensor_runtime_is_running(void);
esp_err_t sensor_runtime_reset_session_data(void);
esp_err_t sensor_runtime_get_latest(sensor_snapshot_t *out);
sensor_mode_t sensor_runtime_get_mode(void);
bool sensor_runtime_is_calibrating(void);
bool sensor_runtime_is_session_active(void);

#ifdef __cplusplus
}
#endif