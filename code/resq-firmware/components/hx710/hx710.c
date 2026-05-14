#include "hx710.h"

#include "esp_rom_sys.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

esp_err_t hx710_init(gpio_num_t sck_pin, gpio_num_t dout_pin)
{
  esp_err_t err;

  /* Validate GPIO arguments */
  if (!GPIO_IS_VALID_OUTPUT_GPIO(sck_pin)) {
    return ESP_ERR_INVALID_ARG;
  }

  if (!GPIO_IS_VALID_GPIO(dout_pin)) {
    return ESP_ERR_INVALID_ARG;
  }

  if (sck_pin == dout_pin) {
    return ESP_ERR_INVALID_ARG;
  }

  /* Configure SCK as output and keep it LOW when idle */
  err = gpio_reset_pin(sck_pin);
  if (err != ESP_OK) {
    return err;
  }

  err = gpio_set_direction(sck_pin, GPIO_MODE_OUTPUT);
  if (err != ESP_OK) {
    return err;
  }

  err = gpio_set_level(sck_pin, 0);
  if (err != ESP_OK) {
    return err;
  }

  /* Configure DOUT as input */
  err = gpio_reset_pin(dout_pin);
  if (err != ESP_OK) {
    return err;
  }

  err = gpio_set_direction(dout_pin, GPIO_MODE_INPUT);
  if (err != ESP_OK) {
    return err;
  }

  return ESP_OK;
}

int32_t hx710_read(gpio_num_t sck_pin, gpio_num_t dout_pin)
{
  int timeout_ticks = 0;
  const int max_wait_ticks = 50;

  while (gpio_get_level(dout_pin) == 1) {
    vTaskDelay(1);
    timeout_ticks++;

    if (timeout_ticks > max_wait_ticks) {
      return HX710_ERROR_TIMEOUT;
    }
  }

  int32_t raw_data = 0;

  for (int i = 0; i < 24; i++) {
    gpio_set_level(sck_pin, 1);
    esp_rom_delay_us(1);

    raw_data <<= 1;

    gpio_set_level(sck_pin, 0);
    esp_rom_delay_us(1);

    if (gpio_get_level(dout_pin)) {
      raw_data++;
    }
  }

  /* Extra clock pulse to complete HX710 read cycle */
  gpio_set_level(sck_pin, 1);
  esp_rom_delay_us(1);
  gpio_set_level(sck_pin, 0);
  esp_rom_delay_us(1);

  /* Sign extend 24-bit two's complement value */
  if (raw_data & 0x800000) {
    raw_data |= 0xFF000000;
  }

  return raw_data;
}