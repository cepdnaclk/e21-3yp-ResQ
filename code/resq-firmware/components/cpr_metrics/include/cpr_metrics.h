#ifndef CPR_METRICS_H
#define CPR_METRICS_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"
#include "resq_config_types.h"

#ifdef __cplusplus
extern "C" {
#endif

#define CPR_FLAGS_MAX_LEN 160
#define CPR_HAND_PLACEMENT_MAX_LEN 24

typedef struct {
    int32_t pressure_0_raw;
    int32_t pressure_1_raw;
    int32_t pressure_2_raw;
    int32_t hall_raw;
    int64_t ts_ms;
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
    char flags[CPR_FLAGS_MAX_LEN];
    int64_t ts_ms;
} cpr_metrics_snapshot_t;

typedef enum {
    CPR_SENSOR_HEALTH_OK = 0,
    CPR_SENSOR_HEALTH_WARNING,
    CPR_SENSOR_HEALTH_FAIL,
} cpr_sensor_health_t;

typedef enum {
    CPR_READINESS_READY_FOR_SESSION = 0,
    CPR_READINESS_WARNING,
    CPR_READINESS_NOT_READY,
} cpr_sensor_readiness_t;

enum {
    CPR_SENSOR_FAULT_NONE = 0,
    CPR_SENSOR_FAULT_TOO_FEW_SAMPLES = 1 << 0,
    CPR_SENSOR_FAULT_STUCK_ZERO = 1 << 1,
    CPR_SENSOR_FAULT_SATURATED = 1 << 2,
    CPR_SENSOR_FAULT_STUCK_NO_CHANGE = 1 << 3,
    CPR_SENSOR_FAULT_NOISY_BASELINE = 1 << 4,
    CPR_SENSOR_FAULT_NO_RESPONSE = 1 << 5,
    CPR_SENSOR_FAULT_RELEASE_NOT_NEAR_BASELINE = 1 << 6,
    CPR_SENSOR_FAULT_IMBALANCED = 1 << 7,
    CPR_SENSOR_FAULT_INVALID_RANGE = 1 << 8,
};

typedef struct {
    cpr_sensor_health_t health;
    uint32_t fault_flags;
    int32_t baseline_1;
    int32_t baseline_2;
    int32_t noise_1;
    int32_t noise_2;
    int32_t max_delta_1;
    int32_t max_delta_2;
    int32_t release_delta_1;
    int32_t release_delta_2;
    int32_t response_delta;
    int32_t imbalance_pct;
    bool baseline_stable;
    bool response_detected;
    bool release_near_baseline;
    bool balanced;
} cpr_pressure_window_result_t;

typedef struct {
    cpr_sensor_health_t health;
    uint32_t fault_flags;
    int32_t baseline;
    int32_t noise;
    int32_t max_delta;
    int32_t release_delta;
    float depth_progress;
    bool baseline_stable;
    bool movement_detected;
    bool full_depth_detected;
    bool recoil_detected;
} cpr_hall_window_result_t;

typedef struct {
    cpr_sensor_readiness_t readiness;
    cpr_sensor_health_t health;
    uint32_t pressure_fault_flags;
    uint32_t hall_fault_flags;
    bool pressure_ok;
    bool hall_ok;
} cpr_sensor_readiness_result_t;

esp_err_t cpr_metrics_init(void);

esp_err_t cpr_metrics_reset(const calibration_config_t *calibration);

esp_err_t cpr_metrics_update(const cpr_sensor_sample_t *sample);

esp_err_t cpr_metrics_get_snapshot(cpr_metrics_snapshot_t *out_snapshot);

esp_err_t pressure_sensor_evaluate_window(const int32_t *pressure_1_samples,
                                          const int32_t *pressure_2_samples,
                                          size_t sample_count,
                                          size_t baseline_sample_count,
                                          const calibration_config_t *calibration,
                                          cpr_pressure_window_result_t *out_result);

esp_err_t hall_sensor_evaluate_window(const int32_t *hall_samples,
                                      size_t sample_count,
                                      size_t baseline_sample_count,
                                      const calibration_config_t *calibration,
                                      cpr_hall_window_result_t *out_result);

int32_t hall_sensor_compute_delta(int32_t raw_value,
                                  int32_t baseline,
                                  int32_t direction);

int32_t pressure_sensor_compute_balance_pct(int32_t pressure_1_delta,
                                            int32_t pressure_2_delta,
                                            int32_t pressure_1_range_raw,
                                            int32_t pressure_2_range_raw);

esp_err_t sensor_readiness_evaluate(const cpr_pressure_window_result_t *pressure,
                                    const cpr_hall_window_result_t *hall,
                                    cpr_sensor_readiness_result_t *out_result);

#ifdef __cplusplus
}
#endif

#endif
