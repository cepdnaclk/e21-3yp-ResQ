#pragma once

#include <stdbool.h>
#include <stddef.h>

#include "esp_err.h"
#include "freertos/FreeRTOS.h"

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t wifi_manager_init(void);
esp_err_t wifi_manager_connect_sta(const char *ssid, const char *password, TickType_t timeout_ticks);
esp_err_t wifi_manager_disconnect(void);
esp_err_t wifi_manager_reconnect_last(TickType_t timeout_ticks);
bool wifi_manager_is_connected(void);
esp_err_t wifi_manager_get_ip(char *out, size_t out_len);

#ifdef __cplusplus
}
#endif