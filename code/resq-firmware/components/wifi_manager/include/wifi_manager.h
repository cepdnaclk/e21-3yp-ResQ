#ifndef WIFI_MANAGER_H
#define WIFI_MANAGER_H

#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

#define WIFI_MANAGER_DEFAULT_MAX_RETRIES      5
#define WIFI_MANAGER_DEFAULT_TIMEOUT_MS       30000

esp_err_t wifi_manager_init(void);

esp_err_t wifi_manager_connect(const char *ssid,
                               const char *password,
                               int max_retries,
                               int timeout_ms);

esp_err_t wifi_manager_disconnect(void);

bool wifi_manager_is_connected(void);

esp_err_t wifi_manager_get_ip(char *buffer, size_t buffer_len);

int wifi_manager_get_rssi(void);

#ifdef __cplusplus
}
#endif

#endif /* WIFI_MANAGER_H */
