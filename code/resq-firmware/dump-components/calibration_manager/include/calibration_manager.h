#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"
#include "config_store.h"

#ifdef __cplusplus
extern "C" {
#endif

#define CAL_PROFILE_ID_LEN 32

typedef enum {
    CAL_RESULT_NONE = 0,
    CAL_RESULT_RUNNING,
    CAL_RESULT_PASS,
    CAL_RESULT_WARNING,
    CAL_RESULT_FAIL,
    CAL_RESULT_CANCELLED,
    CAL_RESULT_EXPIRED
} calibration_result_t;

typedef struct {
    int32_t hall_baseline_actual;
    int32_t hall_baseline_expected;
    int32_t hall_noise;
    int32_t force1_base_actual;
    int32_t force2_base_actual;
    bool pass;
} calibration_normal_result_t;

typedef struct {
    int32_t force1_expected;
    int32_t force2_expected;
    int32_t force1_actual;
    int32_t force2_actual;
    float imbalance_pct;
    bool pass;
} calibration_pressure_result_t;

typedef struct {
    int32_t target_depth_mm;
    int32_t peak_hall_delta;
    float estimated_depth_mm;
    bool pass;
} calibration_depth_result_t;

typedef struct {
    int32_t return_delta;
    int32_t return_depth_mm;
    bool pass;
} calibration_recoil_result_t;

typedef struct {
    char profile_id[CAL_PROFILE_ID_LEN];

    calibration_result_t result;
    bool ready_for_session;

    uint64_t started_at_ms;
    uint64_t validated_at_ms;

    calibration_normal_result_t normal;
    calibration_pressure_result_t pressure;
    calibration_depth_result_t depth;
    calibration_recoil_result_t recoil;
    bool normal_captured;
    bool full_depth_captured;
} calibration_report_t;

esp_err_t calibration_manager_init(const device_config_t *cfg);
esp_err_t calibration_manager_apply_config(const device_config_t *cfg);

esp_err_t calibration_manager_start(const char *profile_id);
esp_err_t calibration_manager_capture_normal(void);
esp_err_t calibration_manager_capture_full_depth(void);
esp_err_t calibration_manager_validate(void);
esp_err_t calibration_manager_cancel(void);

bool calibration_manager_is_ready(void);
bool calibration_manager_is_ready_for_profile(const char *profile_id);
calibration_result_t calibration_manager_get_result(void);
const calibration_report_t *calibration_manager_get_report(void);
bool calibration_manager_get_report_copy(calibration_report_t *out);

const char *calibration_manager_result_to_string(calibration_result_t result);

#ifdef __cplusplus
}
#endif
