#pragma once

#include <stdint.h>

#include "driver/gpio.h"
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

#define HX710_ERROR_TIMEOUT (-999999)
#define HX710_VALID_CHANNEL_0 0x01u
#define HX710_VALID_CHANNEL_1 0x02u
#define HX710_VALID_CHANNEL_2 0x04u
#define HX710_VALID_CHANNEL_ALL 0x07u

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

/**
 * @brief Read three HX710 sensors that share a single SCK line in one synchronized transaction.
 *
 * This clocks the shared SCK and samples all three DOUT pins during the same 24-bit transfer.
 *
 * @param sck_pin  GPIO used as the shared HX710 clock pin.
 * @param dout0_pin GPIO used for sensor 0 DOUT.
 * @param dout1_pin GPIO used for sensor 1 DOUT.
 * @param dout2_pin GPIO used for sensor 2 DOUT.
 * @param out0 pointer to receive sensor 0 signed 24-bit value.
 * @param out1 pointer to receive sensor 1 signed 24-bit value.
 * @param out2 pointer to receive sensor 2 signed 24-bit value.
 *
 * @return ESP_OK on success, or an ESP error code on failure (e.g., ESP_ERR_TIMEOUT).
 */
esp_err_t hx710_read_3_shared_sck(gpio_num_t sck_pin,
								  gpio_num_t dout0_pin,
								  gpio_num_t dout1_pin,
								  gpio_num_t dout2_pin,
								  int32_t *out0,
								  int32_t *out1,
								  int32_t *out2);

/** Read every ready channel without allowing one stalled DOUT to block the
 * others. out_valid_mask reports which returned values are usable. */
esp_err_t hx710_read_3_shared_sck_valid(gpio_num_t sck_pin,
                                       gpio_num_t dout0_pin,
                                       gpio_num_t dout1_pin,
                                       gpio_num_t dout2_pin,
                                       int32_t *out0,
                                       int32_t *out1,
                                       int32_t *out2,
                                       uint8_t *out_valid_mask);

#ifdef __cplusplus
}
#endif
