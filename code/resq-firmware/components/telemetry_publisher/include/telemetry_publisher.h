#ifndef TELEMETRY_PUBLISHER_H
#define TELEMETRY_PUBLISHER_H

#include <stdbool.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t telemetry_publisher_init(void);

esp_err_t telemetry_publisher_start(void);

esp_err_t telemetry_publisher_stop(void);

bool telemetry_publisher_is_running(void);

#ifdef __cplusplus
}
#endif

#endif
