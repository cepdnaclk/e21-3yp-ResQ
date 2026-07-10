#ifndef SENSOR_OWNER_H
#define SENSOR_OWNER_H

#include <stdbool.h>

#include "esp_err.h"
#include "freertos/FreeRTOS.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    SENSOR_OWNER_NONE = 0,
    SENSOR_OWNER_MANUAL_STREAM,
    SENSOR_OWNER_CALIBRATION,
    SENSOR_OWNER_SESSION,
} sensor_owner_t;

esp_err_t sensor_owner_init(void);
esp_err_t sensor_owner_acquire(sensor_owner_t owner);
esp_err_t sensor_owner_release(sensor_owner_t owner);
sensor_owner_t sensor_owner_get(void);
bool sensor_owner_is(sensor_owner_t owner);
esp_err_t sensor_owner_wait_until_free(TickType_t timeout);
void sensor_owner_reset_for_test(void);

#ifdef __cplusplus
}
#endif

#endif
