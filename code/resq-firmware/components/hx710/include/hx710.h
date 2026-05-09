/**
 * @file hx710.h
 * @brief Public interface for the HX710 load-cell / ADC sensor driver.
 *
 * This header declares the minimal API required to configure and read an HX710
 * sensor using two GPIO pins:
 * - SCK: clock/output pin
 * - DOUT: data/input pin
 *
 * The functions are C-linkage compatible so they can be safely included from
 * both C and C++ source files.
 */

/**
 * @brief Error code returned when a sensor read operation times out.
 *
 * This value indicates that the driver waited for the HX710 data line to become
 * ready, but the device did not respond within the expected time window.
 */
 
/**
 * @brief Configure the GPIO pins used to communicate with the HX710 sensor.
 *
 * This function prepares the sensor interface by setting:
 * - SCK as an output pin
 * - DOUT as an input pin
 *
 * Call this once before attempting any reads from the sensor.
 *
 * @param sck_pin GPIO number used for the clock/output signal.
 * @param dout_pin GPIO number used for the data/input signal.
 */

/**
 * @brief Read one 24-bit raw sample from the HX710 sensor.
 *
 * The function clocks out a single measurement from the HX710 and returns the
 * raw signed value as a 32-bit integer.
 *
 * @param sck_pin GPIO number used for the clock/output signal.
 * @param dout_pin GPIO number used for the data/input signal.
 *
 * @return The sensor reading as a signed 32-bit integer, or HX710_ERROR_TIMEOUT
 *         if the sensor does not become ready in time.
 */
#pragma once

// Fixed-width integer types like int


// ESP-IDF GPIO types such as gpio_num_t
#include "driver/gpio.h"

// If this header is included from C++ code,
// expose the function names with C linkage
// so name mangling does not happen.
#ifdef __cplusplus
extern "C" {
#endif

// Special error value returned when HX710 read
// times out while waiting for data to become ready.
#define HX710_ERROR_TIMEOUT (-999999)

// Initializes one HX710 sensor interface.
//
// Parameters:
// - sck_pin  : GPIO used as the clock/output pin
// - dout_pin : GPIO used as the data/input pin
//
// This function sets:
// - SCK as output
// - DOUT as input
void hx710_init(gpio_num_t sck_pin, gpio_num_t dout_pin);

// Reads one 24-bit value from the HX710 sensor.
//
// Parameters:
// - sck_pin  : GPIO used as the clock/output pin
// - dout_pin : GPIO used as the data/input pin
//
// Returns:
// - sensor raw reading as a signed 32-bit integer
// - HX710_ERROR_TIMEOUT if the sensor does not respond in time
int hx710_read(gpio_num_t sck_pin, gpio_num_t dout_pin);

// End of C linkage block for C++ compatibility
#ifdef __cplusplus
}
#endif