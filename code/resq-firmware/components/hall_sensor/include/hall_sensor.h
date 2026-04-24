#pragma once  // Prevents this header from being included multiple times

#include "esp_adc/adc_oneshot.h"  // ESP-IDF ADC one-shot API
#include "esp_err.h"              // ESP-IDF error codes and esp_err_t

#ifdef __cplusplus
extern "C" {
#endif

// Represents a hall sensor instance and its ADC configuration/state
typedef struct {
  adc_oneshot_unit_handle_t adc_handle;  // ADC unit handle used for reading the sensor
  adc_channel_t channel;                 // ADC channel connected to the hall sensor
  int baseline;                          // Reference value used to compute the sensor delta
} hall_sensor_t;

// Initializes the hall sensor with the given ADC channel and baseline value
esp_err_t hall_sensor_init(hall_sensor_t *sensor, adc_channel_t channel, int baseline);

// Reads the raw ADC value from the hall sensor
esp_err_t hall_sensor_read_raw(hall_sensor_t *sensor, int *raw_value);

// Calculates the difference between the current raw value and the baseline
int hall_sensor_calculate_delta(hall_sensor_t *sensor, int raw_value);

#ifdef __cplusplus
}
#endif