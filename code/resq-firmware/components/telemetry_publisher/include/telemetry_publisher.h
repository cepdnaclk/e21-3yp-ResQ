#ifndef TELEMETRY_PUBLISHER_H
#define TELEMETRY_PUBLISHER_H

#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"
#include "mqtt_manager.h"
#include "resq_config_types.h"
#include "states.h"

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t telemetry_publisher_init(void);

esp_err_t telemetry_publisher_start(void);

esp_err_t telemetry_publisher_stop(void);

bool telemetry_publisher_is_running(void);

esp_err_t telemetry_publisher_start_sensor_stream(uint32_t interval_ms,
                                                  resq_state_t state,
                                                  const calibration_config_t *calibration_config);

esp_err_t telemetry_publisher_stop_sensor_stream(void);

bool telemetry_publisher_is_sensor_stream_running(void);

esp_err_t telemetry_publisher_handle_sensor_stream_command(const network_config_t *network_config,
                                                           resq_state_t state,
                                                           const calibration_config_t *calibration_config,
                                                           const resq_mqtt_command_t *command,
                                                           bool allow_start);

#ifdef __cplusplus
}
#endif

#endif
