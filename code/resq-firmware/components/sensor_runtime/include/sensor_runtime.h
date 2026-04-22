#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"
#include "cpr_logic.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Latest processed sensor data snapshot.
 *
 * This structure is the clean output of the sensor runtime layer.
 * Other parts of the firmware should read this instead of directly
 * touching the HX710 / Hall sensor drivers.
 */
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

/**
 * @brief Initialize all sensor-side runtime resources.
 *
 * This initializes:
 * - both HX710 interfaces
 * - Hall sensor ADC
 * - CPR state and thresholds
 * - internal mutex / latest snapshot storage
 */
esp_err_t sensor_runtime_init(void);

/**
 * @brief Start the background sensor task.
 */
esp_err_t sensor_runtime_start(void);

/**
 * @brief Get the latest snapshot produced by the sensor task.
 *
 * @param out Caller-provided output structure
 * @return ESP_OK on success
 */
esp_err_t sensor_runtime_get_latest(sensor_snapshot_t *out);

#ifdef __cplusplus
}
#endif