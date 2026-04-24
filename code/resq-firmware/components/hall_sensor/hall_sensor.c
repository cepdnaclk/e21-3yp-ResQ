#include "hall_sensor.h"

#include <stdlib.h>

/*
 * Initialize the hall sensor structure and configure the ADC channel.
 * - Stores the selected ADC channel and baseline value
 * - Creates a new ADC one-shot unit handle
 * - Configures the ADC channel with default bit width and 12 dB attenuation
 */
esp_err_t hall_sensor_init(hall_sensor_t *sensor, adc_channel_t channel, int baseline)
{
  /* Validate input pointer */
  if (sensor == NULL) {
    return ESP_ERR_INVALID_ARG;
  }

  /* Save configuration values in the sensor object */
  sensor->channel = channel;
  sensor->baseline = baseline;

  /* Set up the ADC unit configuration */
  adc_oneshot_unit_init_cfg_t init_config = {
    .unit_id = ADC_UNIT_1,
  };

  /* Create a new ADC one-shot unit handle */
  esp_err_t err = adc_oneshot_new_unit(&init_config, &sensor->adc_handle);
  if (err != ESP_OK) {
    return err;
  }

  /* Configure the ADC channel settings */
  adc_oneshot_chan_cfg_t config = {
    .bitwidth = ADC_BITWIDTH_DEFAULT,
    .atten = ADC_ATTEN_DB_12,
  };

  /* Apply channel configuration */
  err = adc_oneshot_config_channel(sensor->adc_handle, sensor->channel, &config);
  if (err != ESP_OK) {
    return err;
  }

  return ESP_OK;
}

/*
 * Read a raw ADC value from the hall sensor channel.
 * - Validates pointers
 * - Reads the current ADC value into raw_value
 */
esp_err_t hall_sensor_read_raw(hall_sensor_t *sensor, int *raw_value)
{
  /* Validate input pointers */
  if (sensor == NULL || raw_value == NULL) {
    return ESP_ERR_INVALID_ARG;
  }

  /* Read the ADC value from the configured channel */
  return adc_oneshot_read(sensor->adc_handle, sensor->channel, raw_value);
}

/*
 * Calculate the absolute difference between the current raw reading
 * and the stored baseline value.
 */
int hall_sensor_calculate_delta(hall_sensor_t *sensor, int raw_value)
{
  return abs(raw_value - sensor->baseline);
}