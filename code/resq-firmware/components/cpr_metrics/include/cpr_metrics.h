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
#define CPR_PRESSURE_CENTER_SCORE_THRESHOLD_PCT 88.0f
#define CPR_LIVE_METRIC_WINDOW_SIZE 5
#define CPR_LIVE_METRIC_EMA_ALPHA 0.60f
#ifndef CPR_PAUSE_CONDITION_THRESHOLD_S
#define CPR_PAUSE_CONDITION_THRESHOLD_S 1.0f
#endif

#define CPR_SAMPLE_PRESSURE_0_READ_FAILED    (1u << 0)
#define CPR_SAMPLE_PRESSURE_1_READ_FAILED    (1u << 1)
#define CPR_SAMPLE_PRESSURE_2_READ_FAILED    (1u << 2)
#define CPR_SAMPLE_PRESSURE_READ_FAILED      \
    (CPR_SAMPLE_PRESSURE_0_READ_FAILED | CPR_SAMPLE_PRESSURE_1_READ_FAILED | \
     CPR_SAMPLE_PRESSURE_2_READ_FAILED)
#define CPR_SAMPLE_HALL_READ_FAILED          (1u << 3)

#define CPR_SENSOR_QUALITY_PRESSURE_MISSED       (1u << 0)
#define CPR_SENSOR_QUALITY_HALL_MISSED           (1u << 1)
#define CPR_SENSOR_QUALITY_PRESSURE_SATURATED    (1u << 2)
#define CPR_SENSOR_QUALITY_PRESSURE_BALANCE_HELD (1u << 3)
#define CPR_SENSOR_QUALITY_HAND_PLACEMENT_UNAVAILABLE (1u << 4)
#define CPR_SENSOR_QUALITY_PRESSURE_UNSTABLE      (1u << 5)
#define CPR_SENSOR_QUALITY_PRESSURE_OUT_OF_RANGE  (1u << 6)
#define CPR_SENSOR_QUALITY_PRESSURE_BELOW_CONTACT (1u << 7)
#define CPR_SENSOR_QUALITY_PRESSURE_STALE         (1u << 8)
#define CPR_SENSOR_QUALITY_PRESSURE_CROSSOVER     (1u << 9)

typedef enum {
    CPR_PRESSURE_LOCK_NONE = 0,
    CPR_PRESSURE_LOCK_UPPER_LIMIT,
    CPR_PRESSURE_LOCK_SATURATION,
    CPR_PRESSURE_LOCK_CALIBRATED_CROSSOVER,
} cpr_pressure_lock_reason_t;

typedef struct {
    int32_t pressure_0_raw;
    int32_t pressure_1_raw;
    int32_t pressure_2_raw;
    int32_t hall_raw;
    int64_t ts_ms;
    uint32_t quality_flags;
    uint8_t pressure_valid_mask;
    uint8_t pressure_saturation_mask;
    int64_t pressure_timestamp_ms;
    uint32_t pressure_sequence;
    bool pressure_frame_fresh;
    bool pressure_acquisition_active;
    bool pressure_temporarily_degraded;
} cpr_sensor_sample_t;

typedef struct {
    float depth_progress;
    float depth_mm;
    bool depth_mm_valid;
    float rate_cpm;
    float pause_s;
    int total_compressions;
    int completed_compressions;
    int depth_ok_compressions;
    int valid_compressions;
    int recoil_ok_count;
    int incomplete_recoil_count;
    float recoil_pct;
    bool recoil_pct_valid;
    /* Peak excursion of the most recently completed compression. */
    float last_compression_peak_depth_mm;
    /* Arithmetic mean of one peak excursion from each completed compression. */
    float average_completed_compression_peak_depth_mm;
    bool current_depth_in_range;
    bool last_compression_depth_ok;
    bool last_compression_recoil_ok;
    bool last_compression_incomplete_recoil;
    bool depth_ok;
    bool recoil_ok;
    char hand_placement[CPR_HAND_PLACEMENT_MAX_LEN];
    float pressure_balance_pct;
    bool pressure_balance_reliable;
    calibration_pressure_mode_t pressure_mode;
    bool pressure_degraded;
    bool using_last_stable_pressure;
    bool pressure_valid;
    bool hall_valid;
    float pressure_0_kpa;
    float pressure_1_kpa;
    float pressure_2_kpa;
    bool pressure_0_kpa_valid;
    bool pressure_1_kpa_valid;
    bool pressure_2_kpa_valid;
    bool pressure_kpa_valid;
    bool hall_mm_valid;
    bool pressure_acquisition_active;
    bool pressure_frame_fresh;
    bool pressure_temporarily_degraded;
    uint8_t pressure_current_valid_mask;
    uint8_t pressure_invalid_mask;
    uint8_t pressure_saturation_mask;
    uint8_t pressure_upper_limit_mask;
    uint8_t pressure_below_contact_mask;
    uint8_t pressure_out_of_range_mask;
    uint8_t pressure_stable_mask;
    uint8_t pressure_decision_usable_mask;
    bool pressure_last_stable_available;
    bool pressure_last_accepted_available;
    int64_t pressure_last_accepted_age_ms;
    bool pressure_using_last_stable;
    bool pressure_evidence_sufficient;
    bool hand_placement_locked;
    cpr_pressure_lock_reason_t pressure_lock_reason;
    bool pressure_became_unusable;
    unsigned accepted_pressure_samples;
    uint32_t sensor_quality_flags;
    int missed_pressure_samples;
    int missed_hall_samples;
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

/**
 * Clear session-only live filters after the final snapshot has been captured.
 * Compression counters and completed-event metrics are preserved.
 */
esp_err_t cpr_metrics_clear_live_filters(void);

/**
 * Clamp and reconcile a CPR metric snapshot, then derive its compatible
 * comma-separated flags from the authoritative metric booleans/conditions.
 */
esp_err_t cpr_metrics_normalize_snapshot(cpr_metrics_snapshot_t *snapshot);

const char *cpr_pressure_lock_reason_to_string(
    cpr_pressure_lock_reason_t reason);

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

/**
 * True only when bladder saturation occurs in the explicitly calibrated
 * deep-compression Hall region. Saturation before this boundary remains a
 * sensor fault.
 */
bool cpr_pressure_saturation_is_calibrated_crossover(
    const calibration_config_t *calibration,
    int32_t hall_delta,
    uint8_t saturation_mask);

esp_err_t sensor_readiness_evaluate(const cpr_pressure_window_result_t *pressure,
                                    const cpr_hall_window_result_t *hall,
                                    cpr_sensor_readiness_result_t *out_result);

#ifdef __cplusplus
}
#endif

#endif
