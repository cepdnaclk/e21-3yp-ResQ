#ifndef CPR_METRICS_H
#define CPR_METRICS_H

#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"
#include "resq_config_types.h"

#ifdef __cplusplus
extern "C" {
#endif

#define CPR_FLAGS_MAX_LEN 160
#define CPR_HAND_PLACEMENT_MAX_LEN 24

#define CPR_SAMPLE_PRESSURE_READ_FAILED      (1u << 0)
#define CPR_SAMPLE_HALL_READ_FAILED          (1u << 1)

#define CPR_SENSOR_QUALITY_PRESSURE_MISSED       (1u << 0)
#define CPR_SENSOR_QUALITY_HALL_MISSED           (1u << 1)
#define CPR_SENSOR_QUALITY_PRESSURE_SATURATED    (1u << 2)
#define CPR_SENSOR_QUALITY_PRESSURE_BALANCE_HELD (1u << 3)

typedef struct {
    int32_t pressure_0_raw;
    int32_t pressure_1_raw;
    int32_t pressure_2_raw;
    int32_t hall_raw;
    int64_t ts_ms;
    uint32_t quality_flags;
} cpr_sensor_sample_t;

typedef struct {
    float depth_progress;
    float rate_cpm;
    float pause_s;
    int total_compressions;
    int valid_compressions;
    int recoil_ok_count;
    int incomplete_recoil_count;
    bool depth_ok;
    bool recoil_ok;
    char hand_placement[CPR_HAND_PLACEMENT_MAX_LEN];
    float pressure_balance_pct;
    bool pressure_balance_reliable;
    uint8_t pressure_saturation_mask;
    uint32_t sensor_quality_flags;
    int missed_pressure_samples;
    int missed_hall_samples;
    char flags[CPR_FLAGS_MAX_LEN];
    int64_t ts_ms;
} cpr_metrics_snapshot_t;

esp_err_t cpr_metrics_init(void);

esp_err_t cpr_metrics_reset(const calibration_config_t *calibration);

esp_err_t cpr_metrics_update(const cpr_sensor_sample_t *sample);

esp_err_t cpr_metrics_get_snapshot(cpr_metrics_snapshot_t *out_snapshot);

#ifdef __cplusplus
}
#endif

#endif
