#pragma once

#include "esp_err.h"
#include <stdbool.h>
#include "esp_adc/adc_oneshot.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
  adc_channel_t channel;
  bool initialized;
} hall_sensor_t;

esp_err_t hall_sensor_init(hall_sensor_t *sensor, adc_channel_t channel);

esp_err_t hall_sensor_read_raw(hall_sensor_t *sensor, int *raw_value);

#ifdef __cplusplus
}
#endif