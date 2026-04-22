#pragma once

#include <stdbool.h>
#include <stddef.h>

#include "esp_err.h"
#include "freertos/FreeRTOS.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Initialize Wi-Fi station manager.
 */
esp_err_t wifi_manager_init(void);

/**
 * @brief Connect to the given Wi-Fi network in STA mode.
 *
 * @param ssid Wi-Fi SSID
 * @param password Wi-Fi password
 * @param timeout_ticks How long to wait for connection result
 */
esp_err_t wifi_manager_connect_sta(const char *ssid, const char *password, TickType_t timeout_ticks);

/**
 * @brief Disconnect from current Wi-Fi network.
 */
esp_err_t wifi_manager_disconnect(void);

/**
 * @brief Returns true if station is connected and has IP.
 */
bool wifi_manager_is_connected(void);

/**
 * @brief Write current station IP as a string.
 */
esp_err_t wifi_manager_get_ip(char *out, size_t out_len);

#ifdef __cplusplus
}
#endif