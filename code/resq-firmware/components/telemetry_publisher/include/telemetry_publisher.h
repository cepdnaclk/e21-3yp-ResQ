#ifndef TELEMETRY_PUBLISHER_H
#define TELEMETRY_PUBLISHER_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"
#include "cpr_metrics.h"
#include "mqtt_manager.h"
#include "resq_config_types.h"
#include "sensor_conversion.h"
#include "states.h"

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t telemetry_publisher_init(void);

esp_err_t telemetry_publisher_start(void);

esp_err_t telemetry_publisher_stop(void);

esp_err_t telemetry_publisher_stop_all(void);

bool telemetry_publisher_is_running(void);

esp_err_t telemetry_publisher_start_sensor_stream(uint32_t interval_ms,
                                                  resq_state_t state,
                                                  const calibration_config_t *calibration_config);

esp_err_t telemetry_publisher_stop_sensor_stream(void);

bool telemetry_publisher_is_sensor_stream_running(void);

#define TELEMETRY_SENSOR_STREAM_INTERVAL_DEFAULT_MS 200u
#define TELEMETRY_SENSOR_STREAM_INTERVAL_MIN_MS 100u
#define TELEMETRY_SENSOR_STREAM_INTERVAL_MAX_MS 1000u

esp_err_t telemetry_publisher_build_session_payload(const cpr_metrics_snapshot_t *snap,
                                                     const char *device_id,
                                                     const char *session_id,
                                                     char *out_payload,
                                                     size_t out_payload_len);

esp_err_t telemetry_publisher_build_sensor_stream_payload(const char *device_id,
                                                          resq_state_t state,
                                                          const sensor_raw_sample_t *raw,
                                                          const sensor_converted_sample_t *converted,
                                                          uint32_t interval_ms,
                                                          char *out_payload,
                                                          size_t out_payload_len);

esp_err_t telemetry_publisher_validate_sensor_stream_command(const char *payload,
                                                             bool *out_start,
                                                             uint32_t *out_interval_ms);

esp_err_t telemetry_publisher_handle_sensor_stream_command(const network_config_t *network_config,
                                                           resq_state_t state,
                                                           const calibration_config_t *calibration_config,
                                                           const resq_mqtt_command_t *command,
                                                           bool allow_start);

#ifdef __cplusplus
}
#endif

#endif
