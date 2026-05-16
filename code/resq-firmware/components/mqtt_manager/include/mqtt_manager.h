#ifndef MQTT_MANAGER_H
#define MQTT_MANAGER_H

#include <stdbool.h>

#include "esp_err.h"
#include "resq_config_types.h"
#include "states.h"
#include "freertos/FreeRTOS.h"

#ifdef __cplusplus
extern "C" {
#endif

#define MQTT_MANAGER_TOPIC_MAX_LEN      160
#define MQTT_MANAGER_URI_MAX_LEN        160

#define MQTT_MANAGER_COMMAND_TOPIC_MAX_LEN     160
#define MQTT_MANAGER_COMMAND_PAYLOAD_MAX_LEN   512
#define MQTT_MANAGER_COMMAND_QUEUE_LEN         8

typedef struct
{
    char topic[MQTT_MANAGER_COMMAND_TOPIC_MAX_LEN];
    char payload[MQTT_MANAGER_COMMAND_PAYLOAD_MAX_LEN];
    int payload_len;
} resq_mqtt_command_t;

esp_err_t mqtt_manager_wait_for_command(resq_mqtt_command_t *command,
                                        TickType_t timeout_ticks);

esp_err_t mqtt_manager_init(void);

esp_err_t mqtt_manager_start(const char *device_id,
                            const char *mqtt_host,
                            int mqtt_port);

esp_err_t mqtt_manager_stop(void);

bool mqtt_manager_is_connected(void);

const char *mqtt_manager_get_device_id(void);

esp_err_t mqtt_manager_publish_status(resq_state_t state,
                                      const network_config_t *network_config,
                                      const calibration_config_t *calibration_config,
                                      bool session_active,
                                      const char *session_id,
                                      const char *ip);

esp_err_t mqtt_manager_publish_error_status(resq_state_t state,
                                            const network_config_t *network_config,
                                            const calibration_config_t *calibration_config,
                                            bool session_active,
                                            const char *session_id,
                                            const char *ip,
                                            int last_error_id);

esp_err_t mqtt_manager_publish_identity_event(const network_config_t *network_config);

esp_err_t mqtt_manager_publish_heartbeat(const network_config_t *network_config,
                                         const calibration_config_t *calibration_config,
                                         resq_state_t state,
                                         bool session_active,
                                         bool sensor_running,
                                         const char *session_id,
                                         const char *ip,
                                         int rssi);

esp_err_t mqtt_manager_publish_event_json(const char *json_payload);

esp_err_t mqtt_manager_publish_telemetry_json(const char *json_payload);

esp_err_t mqtt_manager_publish_debug_json(const char *json_payload);

esp_err_t mqtt_manager_publish_topic_json(const char *suffix,
                                          const char *json_payload);

#ifdef __cplusplus
}
#endif

#endif /* MQTT_MANAGER_H */
