#pragma once

#include <stdbool.h>
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
#define HX710_READ_PULSE_COUNT 25u

/*
 * Twenty-five PD_SCK pulses select the differential pressure input for the
 * following conversion. The HX710 data sheet specifies 10 samples/second for
 * that selection. The minimum accepts 20% oscillator/tick tolerance while
 * still rejecting the physically impossible rapid-zero sequence seen in HIL.
 */
#define HX710_PRESSURE_DATA_RATE_HZ 10u
#define HX710_NOMINAL_CONVERSION_INTERVAL_MS \
    (1000u / HX710_PRESSURE_DATA_RATE_HZ)
#define HX710_CONVERSION_TOLERANCE_PERCENT 20u
#define HX710_MIN_CONVERSION_INTERVAL_MS                            \
    ((HX710_NOMINAL_CONVERSION_INTERVAL_MS *                       \
      (100u - HX710_CONVERSION_TOLERANCE_PERCENT)) /               \
     100u)
#define HX710_READY_TIMEOUT_MS 150u

typedef struct {
    esp_err_t error;
    esp_err_t cleanup_error;
    int32_t raw[3];
    uint8_t initial_ready_mask;
    uint8_t ready_mask;
    uint8_t valid_mask;
    uint8_t not_ready_mask;
    uint8_t stuck_high_mask;
    uint8_t stuck_low_mask;
    uint8_t post_read_invalid_mask;
    uint8_t cadence_invalid_mask;
    uint8_t next_ready_mask;
    uint8_t pulse_count;
    uint32_t ready_wait_ms;
    uint32_t cadence_wait_ms;
} hx710_group_result_t;

/**
 * @brief Acquire the shared SCK pad for SENSOR mode exactly once.
 *
 * The USB Serial/JTAG PHY is detached before GPIO configuration. GPIO19 is
 * preloaded LOW, configured as an output with both pulls disabled, and verified
 * LOW. Repeated calls are idempotent and never reset or remux an owned pin.
 */
esp_err_t hx710_sck_acquire_for_sensor_mode(gpio_num_t sck_pin);

/**
 * @brief Release an idle HX710 SCK before a controlled reboot into USB mode.
 *
 * The function forces and verifies SCK LOW, changes the pin to a floating GPIO
 * input, and clears HX710 ownership. Native USB is restored by the subsequent
 * reboot; this function does not perform a live USB/HX710 pad swap.
 */
esp_err_t hx710_sck_release_for_usb_mode(void);

bool hx710_sck_is_owned_by_sensor(void);

/**
 * @brief Backward-compatible alias for one-time SENSOR-mode SCK acquisition.
 */
esp_err_t hx710_prepare_shared_sck(gpio_num_t sck_pin);

/**
 * @brief Configure one HX710 DOUT input after shared-SCK ownership is acquired.
 */
esp_err_t hx710_init(gpio_num_t sck_pin, gpio_num_t dout_pin);

/** Keep the owned shared SCK line LOW and verify the physical GPIO level. */
esp_err_t hx710_hold_sck_low(gpio_num_t sck_pin);

/**
 * @brief Legacy single-channel API.
 *
 * A software-selected DOUT is not electrically isolated when multiple HX710s
 * share SCK. This API therefore fails closed for the ResQ shared-clock board.
 */
int32_t hx710_read(gpio_num_t sck_pin, gpio_num_t dout_pin);

/**
 * @brief Explicit legacy single-channel API; returns ESP_ERR_NOT_SUPPORTED.
 *
 * Output arguments are reset only for diagnostic counters. out_raw is never
 * modified because the firmware cannot prove physical isolation.
 */
esp_err_t hx710_read_single(gpio_num_t sck_pin,
                            gpio_num_t dout_pin,
                            int32_t *out_raw,
                            uint32_t *out_wait_ms,
                            uint8_t *out_pulse_count);

/**
 * @brief Perform one validated, synchronized three-channel shared-SCK read.
 *
 * No clock pulse is emitted until all three DOUT pins are LOW. After the 25th
 * pulse, every DOUT must return HIGH and then become LOW again no earlier than
 * HX710_MIN_CONVERSION_INTERVAL_MS. Raw values are valid only if the complete
 * transaction and cadence validation succeed; the raw array remains unchanged
 * on every failure.
 */
esp_err_t hx710_read_group_shared_sck(gpio_num_t sck_pin,
                                      gpio_num_t dout0_pin,
                                      gpio_num_t dout1_pin,
                                      gpio_num_t dout2_pin,
                                      hx710_group_result_t *out_result);

/**
 * @brief Compatibility wrapper with all-or-none output validity.
 *
 * Caller raw outputs are updated only after a complete validated group read.
 * On failure they remain unchanged and out_valid_mask is set to zero.
 */
esp_err_t hx710_read_3_shared_sck_valid(gpio_num_t sck_pin,
                                       gpio_num_t dout0_pin,
                                       gpio_num_t dout1_pin,
                                       gpio_num_t dout2_pin,
                                       int32_t *out0,
                                       int32_t *out1,
                                       int32_t *out2,
                                       uint8_t *out_valid_mask);

esp_err_t hx710_read_3_shared_sck(gpio_num_t sck_pin,
                                  gpio_num_t dout0_pin,
                                  gpio_num_t dout1_pin,
                                  gpio_num_t dout2_pin,
                                  int32_t *out0,
                                  int32_t *out1,
                                  int32_t *out2);

#ifdef __cplusplus
}
#endif
