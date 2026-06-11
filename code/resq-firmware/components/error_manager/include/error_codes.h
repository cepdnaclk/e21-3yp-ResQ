#ifndef ERROR_CODES_H
#define ERROR_CODES_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    FW_ERROR_NONE = 0,

    FW_ERROR_UNKNOWN_ERROR = 1000,
    FW_ERROR_INVALID_STATE_TRANSITION = 1001,
    FW_ERROR_UNSUPPORTED_STATE = 1002,

    FW_ERROR_NVS_INIT_FAILED = 1100,
    FW_ERROR_NVS_LOAD_FAILED = 1101,
    FW_ERROR_NVS_SAVE_FAILED = 1102,
    FW_ERROR_CONFIG_INVALID = 1103,

    FW_ERROR_WIFI_CONNECT_FAILED = 1200,
    FW_ERROR_WIFI_DISCONNECTED_UNRECOVERABLE = 1201,
    FW_ERROR_WIFI_NO_IP_ASSIGNED = 1202,

    FW_ERROR_BACKEND_REGISTER_FAILED = 1300,
    FW_ERROR_BACKEND_INVALID_RESPONSE = 1301,
    FW_ERROR_BACKEND_DEVICE_REJECTED = 1302,

    FW_ERROR_MQTT_CONNECT_FAILED = 1400,
    FW_ERROR_MQTT_DISCONNECTED_UNRECOVERABLE = 1401,
    FW_ERROR_MQTT_SUBSCRIBE_FAILED = 1402,
    FW_ERROR_MQTT_PUBLISH_FAILED = 1403,

    FW_ERROR_HX710_INIT_FAILED = 1500,
    FW_ERROR_HX710_READ_FAILED = 1501,
    FW_ERROR_HALL_SENSOR_INIT_FAILED = 1502,
    FW_ERROR_HALL_SENSOR_READ_FAILED = 1503,
    FW_ERROR_SENSOR_RUNTIME_FAILED = 1504,

    FW_ERROR_TASK_CREATE_FAILED = 1600,
    FW_ERROR_QUEUE_CREATE_FAILED = 1601,
    FW_ERROR_MUTEX_CREATE_FAILED = 1602,
    FW_ERROR_MEMORY_ALLOCATION_FAILED = 1603,

    FW_ERROR_SESSION_START_FAILED = 1700,
    FW_ERROR_TELEMETRY_TASK_FAILED = 1701,
    FW_ERROR_BUZZER_TASK_FAILED = 1702,
    FW_ERROR_SESSION_INTERRUPTED_UNRECOVERABLE = 1703,

    FW_ERROR_FIRMWARE_ASSERT_FAILED = 1800
} firmware_error_reason_id_t;

typedef enum {
    FW_ACTION_NONE = 0,
    FW_ACTION_BUTTON_1_RETRY_BUTTON_2_PROVISIONING = 1,
    FW_ACTION_BUTTON_1_RECONNECT_BUTTON_2_PROVISIONING = 2,
    FW_ACTION_BUTTON_1_RESTART_BUTTON_2_PROVISIONING = 3,
    FW_ACTION_CHECK_HARDWARE_AND_RETRY = 4,
    FW_ACTION_CHECK_BACKEND_AND_RETRY = 5,
    FW_ACTION_CHECK_MQTT_AND_RETRY = 6,
    FW_ACTION_CLEAR_CONFIG_AND_PROVISION = 7,
    FW_ACTION_RESTART_FIRMWARE = 8,
    FW_ACTION_STOP_SESSION_AND_RETURN_READY = 9,
    FW_ACTION_MOVE_TO_TURN_OFF = 10
} firmware_error_action_id_t;

typedef struct {
    firmware_error_reason_id_t reason_id;
    const char *reason_code;
    const char *message;
    firmware_error_action_id_t default_action_id;
} firmware_error_reason_entry_t;

typedef struct {
    firmware_error_action_id_t action_id;
    const char *action_code;
    const char *message;
} firmware_error_action_entry_t;

const firmware_error_reason_entry_t *error_codes_get_reason_entry(firmware_error_reason_id_t reason_id);

const firmware_error_action_entry_t *error_codes_get_action_entry(firmware_error_action_id_t action_id);

const char *error_codes_reason_to_string(firmware_error_reason_id_t reason_id);

const char *error_codes_action_to_string(firmware_error_action_id_t action_id);

firmware_error_action_id_t error_codes_default_action_for_reason(firmware_error_reason_id_t reason_id);

#ifdef __cplusplus
}
#endif

#endif
