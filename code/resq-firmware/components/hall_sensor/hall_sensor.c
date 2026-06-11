#include "hall_sensor.h"
#include "adc_shared_service.h"
#include "board_config.h"
#include "esp_log.h"
#include <string.h>

static const char *TAG = "hall_sensor";

esp_err_t hall_sensor_init(hall_sensor_t *sensor, adc_channel_t channel)
{
  if (sensor == NULL) {
    return ESP_ERR_INVALID_ARG;
  }

  memset(sensor, 0, sizeof(hall_sensor_t));

  sensor->channel = channel;
  sensor->initialized = false;

  if (sensor->channel != BOARD_HALL_ADC_CHAN) {
    ESP_LOGW(TAG, "hall_sensor_init called with channel %d, expected BOARD_HALL_ADC_CHAN (%d)",
             sensor->channel, BOARD_HALL_ADC_CHAN);
    return ESP_ERR_INVALID_ARG;
  }

  esp_err_t err = adc_shared_service_init();
  if (err != ESP_OK) {
    ESP_LOGW(TAG, "adc_shared_service_init failed: %s", esp_err_to_name(err));
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

  if (!sensor->initialized) {
    return ESP_ERR_INVALID_STATE;
  }

  return adc_shared_service_read_hall_raw(raw_value);
}