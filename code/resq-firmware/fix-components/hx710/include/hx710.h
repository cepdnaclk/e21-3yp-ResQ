#pragma once

#include <stdint.h>

#include "driver/gpio.h"
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

#define HX710_ERROR_TIMEOUT (-999999)

/**
 * @brief Configure the GPIO pins used to communicate with the HX710 sensor.
 *
 * @param sck_pin  GPIO used as HX710 clock pin.
 * @param dout_pin GPIO used as HX710 data output pin.
 *
 * @return ESP_OK on success, or ESP-IDF error code on failure.
 */
esp_err_t hx710_init(gpio_num_t sck_pin, gpio_num_t dout_pin);

/**
 * @brief Read one signed 24-bit raw sample from HX710.
 *
 * @param sck_pin  GPIO used as HX710 clock pin.
 * @param dout_pin GPIO used as HX710 data output pin.
 *
 * @return Signed sensor reading, or HX710_ERROR_TIMEOUT on timeout.
 */
int32_t hx710_read(gpio_num_t sck_pin, gpio_num_t dout_pin);

#ifdef __cplusplus
}
#endif