#ifndef IO_MODE_MANAGER_H
#define IO_MODE_MANAGER_H

#include <stdbool.h>

#include "esp_err.h"
#include "resq_config_types.h"

#ifdef __cplusplus
extern "C" {
#endif

#define RESQ_REASON_SENSOR_MODE_REQUIRED "SENSOR_MODE_REQUIRED"

esp_err_t io_mode_manager_init(void);
resq_io_mode_t io_mode_manager_get(void);
bool io_mode_manager_is_sensor(void);
bool io_mode_manager_is_usb(void);

/* Persist a different mode for the next boot. The active mode does not change
 * until restart, which prevents live USB/SCK pin swapping. */
esp_err_t io_mode_manager_request(resq_io_mode_t mode);

const char *io_mode_to_string(resq_io_mode_t mode);

/** Test-only override; production code must never call this function. */
void io_mode_manager_set_for_test(resq_io_mode_t mode);

#ifdef __cplusplus
}
#endif

#endif
