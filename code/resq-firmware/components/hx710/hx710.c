#include "include/hx710.h"

#include "esp_rom_sys.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

/**
 * @brief Initialize HX710 interface GPIOs.
 *
 * @param sck_pin  GPIO used as HX710 clock (SCK), configured as output.
 * @param dout_pin GPIO used as HX710 data output (DOUT), configured as input.
 */
void hx710_init(gpio_num_t sck_pin, gpio_num_t dout_pin)
{
  // Prepare SCK pin: reset state, configure as output, keep low (idle).
  gpio_reset_pin(sck_pin);
  gpio_set_direction(sck_pin, GPIO_MODE_OUTPUT);
  gpio_set_level(sck_pin, 0);

  // Prepare DOUT pin: reset state and configure as input.
  gpio_reset_pin(dout_pin);
  gpio_set_direction(dout_pin, GPIO_MODE_INPUT);
}

/**
 * @brief Read one 24-bit sample from HX710.
 *
 * The function waits until DOUT goes low (data ready), then clocks out
 * 24 bits MSB-first. After the read, one extra clock pulse is sent to
 * complete the conversion cycle/gain selection sequence.
 *
 * @param sck_pin  GPIO used as HX710 clock (SCK).
 * @param dout_pin GPIO used as HX710 data output (DOUT).
 *
 * @return Signed 32-bit converted sample on success,
 *         or HX710_ERROR_TIMEOUT if data-ready wait times out.
 */
int32_t hx710_read(gpio_num_t sck_pin, gpio_num_t dout_pin)
{
  int timeout_ticks = 0;
  const int max_wait_ticks = 50; // Max RTOS ticks to wait for DOUT to go low.

  // Wait for HX710 to indicate data ready (DOUT == 0).
  while (gpio_get_level(dout_pin) == 1) {
    vTaskDelay(1);   // Yield for 1 tick before checking again.
    timeout_ticks++;

    // Abort if sensor does not become ready within timeout window.
    if (timeout_ticks > max_wait_ticks) {
      return HX710_ERROR_TIMEOUT;
    }
  }

  int32_t raw_data = 0;

  // Read 24 bits from HX710, MSB first.
  for (int i = 0; i < 24; i++) {
    // Rising edge: HX710 prepares next bit.
    gpio_set_level(sck_pin, 1);
    esp_rom_delay_us(1);

    // Shift previously read bits to make room for the new LSB.
    raw_data = raw_data << 1;

    // Falling edge: bit value is sampled from DOUT.
    gpio_set_level(sck_pin, 0);
    esp_rom_delay_us(1);

    // If DOUT is high, set current bit to 1.
    if (gpio_get_level(dout_pin)) {
      raw_data++;
    }
  }

  // Send one extra pulse required by HX710 protocol
  // (channel/gain cycle completion depending on device mode).
  gpio_set_level(sck_pin, 1);
  esp_rom_delay_us(1);
  gpio_set_level(sck_pin, 0);
  esp_rom_delay_us(1);

  // Sign-extend 24-bit two's-complement value to 32-bit signed integer.
  if (raw_data & 0x800000) {
    raw_data |= 0xFF000000;
  }

  return raw_data;
}