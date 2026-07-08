// Centralized MQTT topic constants and helpers for ResQ firmware
#ifndef MQTT_TOPICS_H
#define MQTT_TOPICS_H

#include "esp_err.h"
#include <stddef.h>

/* Root */
#define RESQ_MQTT_ROOT_TOPIC                  "resq"

/* Command suffixes */
#define RESQ_SUFFIX_CMD_ROOT                  "cmd/#"
#define RESQ_SUFFIX_CMD_DEBUG                 "cmd/debug"
#define RESQ_SUFFIX_CMD_CALIBRATION_START     "cmd/calibration/start"
#define RESQ_SUFFIX_CMD_CALIBRATION_CANCEL    "cmd/calibration/cancel"
#define RESQ_SUFFIX_CMD_SESSION_START         "cmd/session/start"
#define RESQ_SUFFIX_CMD_SESSION_STOP          "cmd/session/stop"
#define RESQ_SUFFIX_CMD_TELEMETRY             "cmd/telemetry"
#define RESQ_SUFFIX_CMD_SYSTEM_RETRY          "cmd/system/retry"
#define RESQ_SUFFIX_CMD_SYSTEM_RESET          "cmd/system/reset"
#define RESQ_SUFFIX_CMD_SYSTEM_FLUSH_CONFIG   "cmd/system/flush-config"

/* Publish suffixes */
#define RESQ_SUFFIX_STATUS                    "status"
#define RESQ_SUFFIX_HEARTBEAT                 "heartbeat"
#define RESQ_SUFFIX_TELEMETRY                 "telemetry"
#define RESQ_SUFFIX_DEBUG                     "debug"
#define RESQ_SUFFIX_EVENTS                    "events"
#define RESQ_SUFFIX_EVENTS_CALIBRATION        "events/calibration"
#define RESQ_SUFFIX_EVENTS_ERROR              "events/error"

/* Build a fully-qualified topic: resq/{device_id}/{suffix}
 * Returns ESP_OK on success.
 * Returns ESP_ERR_INVALID_ARG when args are invalid.
 * Returns ESP_ERR_INVALID_SIZE when output buffer is too small.
 */
esp_err_t resq_mqtt_build_topic(const char *device_id,
                                const char *suffix,
                                char *out,
                                size_t out_len);

#endif // MQTT_TOPICS_H
