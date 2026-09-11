#ifndef SENSOR_RUNTIME_STATUS_H
#define SENSOR_RUNTIME_STATUS_H

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"

/**
 * Runtime-only sensor status shared by acquisition owners and telemetry.
 *
 * This type is deliberately defined outside calibration_profile_t and is
 * never encoded by config_store.
 */
typedef struct {
  bool pressure_acquisition_enabled;
  bool pressure_current_valid;
  bool pressure_temporarily_degraded;
  bool using_last_stable_pressure;
  bool hall_current_valid;
  uint8_t pressure_valid_mask;
  uint8_t pressure_invalid_mask;
  uint8_t pressure_saturation_mask;
  esp_err_t last_pressure_error;
  int64_t updated_at_ms;
} sensor_runtime_health_t;

#endif /* SENSOR_RUNTIME_STATUS_H */
