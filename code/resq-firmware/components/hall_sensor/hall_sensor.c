#include "hall_sensor.h"

#include <string.h>

esp_err_t hall_sensor_init(hall_sensor_t *sensor, adc_channel_t channel)
{
  if (sensor == NULL) {
    return ESP_ERR_INVALID_ARG;
  }

  memset(sensor, 0, sizeof(hall_sensor_t));

  sensor->channel = channel;
  sensor->initialized = false;

  adc_oneshot_unit_init_cfg_t init_config = {
    .unit_id = ADC_UNIT_1,
  };

  esp_err_t err = adc_oneshot_new_unit(&init_config, &sensor->adc_handle);
  if (err != ESP_OK) {
    return err;
  }

  adc_oneshot_chan_cfg_t channel_config = {
    .bitwidth = ADC_BITWIDTH_DEFAULT,
    .atten = ADC_ATTEN_DB_12,
  };

  err = adc_oneshot_config_channel(sensor->adc_handle,
                                   sensor->channel,
                                   &channel_config);
  if (err != ESP_OK) {
    adc_oneshot_del_unit(sensor->adc_handle);
    sensor->adc_handle = NULL;
    return err;
  }

  sensor->initialized = true;
  return ESP_OK;
}

esp_err_t hall_sensor_read_raw(hall_sensor_t *sensor, int *raw_value)
{
  if (sensor == NULL || raw_value == NULL) {
    return ESP_ERR_INVALID_ARG;
  }

  if (!sensor->initialized || sensor->adc_handle == NULL) {
    return ESP_ERR_INVALID_STATE;
  }

  return adc_oneshot_read(sensor->adc_handle,
                          sensor->channel,
                          raw_value);
}