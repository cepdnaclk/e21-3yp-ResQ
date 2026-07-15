#include "error_codes.h"

#include <stddef.h>

static const firmware_error_reason_entry_t REASON_TABLE[] = {
    { FW_ERROR_NONE, "NONE", "No firmware error", FW_ACTION_NONE },

    { FW_ERROR_UNKNOWN_ERROR, "UNKNOWN_ERROR", "Unknown firmware error", FW_ACTION_BUTTON_1_RESTART_BUTTON_2_PROVISIONING },
    { FW_ERROR_INVALID_STATE_TRANSITION, "INVALID_STATE_TRANSITION", "Firmware entered an invalid state transition", FW_ACTION_BUTTON_1_RESTART_BUTTON_2_PROVISIONING },
    { FW_ERROR_UNSUPPORTED_STATE, "UNSUPPORTED_STATE", "Firmware reached an unsupported state", FW_ACTION_BUTTON_1_RESTART_BUTTON_2_PROVISIONING },

    { FW_ERROR_NVS_INIT_FAILED, "NVS_INIT_FAILED", "NVS initialization failed", FW_ACTION_RESTART_FIRMWARE },
    { FW_ERROR_NVS_LOAD_FAILED, "NVS_LOAD_FAILED", "Failed to load required config from NVS", FW_ACTION_CLEAR_CONFIG_AND_PROVISION },
    { FW_ERROR_NVS_SAVE_FAILED, "NVS_SAVE_FAILED", "Failed to save required config to NVS", FW_ACTION_BUTTON_1_RESTART_BUTTON_2_PROVISIONING },
    { FW_ERROR_CONFIG_INVALID, "CONFIG_INVALID", "Critical saved configuration is invalid", FW_ACTION_CLEAR_CONFIG_AND_PROVISION },

    { FW_ERROR_WIFI_CONNECT_FAILED, "WIFI_CONNECT_FAILED", "Wi-Fi connection failed after retries", FW_ACTION_BUTTON_1_RECONNECT_BUTTON_2_PROVISIONING },
    { FW_ERROR_WIFI_DISCONNECTED_UNRECOVERABLE, "WIFI_DISCONNECTED_UNRECOVERABLE", "Wi-Fi disconnected and recovery failed", FW_ACTION_BUTTON_1_RECONNECT_BUTTON_2_PROVISIONING },
    { FW_ERROR_WIFI_NO_IP_ASSIGNED, "WIFI_NO_IP_ASSIGNED", "Wi-Fi connected but IP was not assigned", FW_ACTION_BUTTON_1_RECONNECT_BUTTON_2_PROVISIONING },

    { FW_ERROR_BACKEND_REGISTER_FAILED, "BACKEND_REGISTER_FAILED", "Backend registration failed after retries", FW_ACTION_CHECK_BACKEND_AND_RETRY },
    { FW_ERROR_BACKEND_INVALID_RESPONSE, "BACKEND_INVALID_RESPONSE", "Backend response did not contain required fields", FW_ACTION_CHECK_BACKEND_AND_RETRY },
    { FW_ERROR_BACKEND_DEVICE_REJECTED, "BACKEND_DEVICE_REJECTED", "Backend rejected device registration", FW_ACTION_CHECK_BACKEND_AND_RETRY },

    { FW_ERROR_MQTT_CONNECT_FAILED, "MQTT_CONNECT_FAILED", "MQTT connection failed after retries", FW_ACTION_CHECK_MQTT_AND_RETRY },
    { FW_ERROR_MQTT_DISCONNECTED_UNRECOVERABLE, "MQTT_DISCONNECTED_UNRECOVERABLE", "MQTT disconnected and recovery failed", FW_ACTION_CHECK_MQTT_AND_RETRY },
    { FW_ERROR_MQTT_SUBSCRIBE_FAILED, "MQTT_SUBSCRIBE_FAILED", "Firmware could not subscribe to command topic", FW_ACTION_CHECK_MQTT_AND_RETRY },
    { FW_ERROR_MQTT_PUBLISH_FAILED, "MQTT_PUBLISH_FAILED", "Critical MQTT publish failed repeatedly", FW_ACTION_CHECK_MQTT_AND_RETRY },

    { FW_ERROR_HX710_INIT_FAILED, "HX710_INIT_FAILED", "HX710 pressure sensor initialization failed", FW_ACTION_CHECK_HARDWARE_AND_RETRY },
    { FW_ERROR_HX710_READ_FAILED, "HX710_READ_FAILED", "HX710 pressure sensor read failed repeatedly", FW_ACTION_CHECK_HARDWARE_AND_RETRY },
    { FW_ERROR_HALL_SENSOR_INIT_FAILED, "HALL_SENSOR_INIT_FAILED", "Hall sensor initialization failed", FW_ACTION_CHECK_HARDWARE_AND_RETRY },
    { FW_ERROR_HALL_SENSOR_READ_FAILED, "HALL_SENSOR_READ_FAILED", "Hall sensor read failed repeatedly", FW_ACTION_CHECK_HARDWARE_AND_RETRY },
    { FW_ERROR_SENSOR_RUNTIME_FAILED, "SENSOR_RUNTIME_FAILED", "Sensor runtime task failed", FW_ACTION_CHECK_HARDWARE_AND_RETRY },

    { FW_ERROR_TASK_CREATE_FAILED, "TASK_CREATE_FAILED", "FreeRTOS task creation failed", FW_ACTION_RESTART_FIRMWARE },
    { FW_ERROR_QUEUE_CREATE_FAILED, "QUEUE_CREATE_FAILED", "FreeRTOS queue creation failed", FW_ACTION_RESTART_FIRMWARE },
    { FW_ERROR_MUTEX_CREATE_FAILED, "MUTEX_CREATE_FAILED", "FreeRTOS mutex creation failed", FW_ACTION_RESTART_FIRMWARE },
    { FW_ERROR_MEMORY_ALLOCATION_FAILED, "MEMORY_ALLOCATION_FAILED", "Memory allocation failed", FW_ACTION_RESTART_FIRMWARE },

    { FW_ERROR_SESSION_START_FAILED, "SESSION_START_FAILED", "Session could not start due to internal runtime error", FW_ACTION_STOP_SESSION_AND_RETURN_READY },
    { FW_ERROR_TELEMETRY_TASK_FAILED, "TELEMETRY_TASK_FAILED", "Telemetry publisher failed", FW_ACTION_STOP_SESSION_AND_RETURN_READY },
    { FW_ERROR_BUZZER_TASK_FAILED, "BUZZER_TASK_FAILED", "Buzzer manager failed", FW_ACTION_STOP_SESSION_AND_RETURN_READY },
    { FW_ERROR_SESSION_INTERRUPTED_UNRECOVERABLE, "SESSION_INTERRUPTED_UNRECOVERABLE", "Interrupted session could not recover safely", FW_ACTION_STOP_SESSION_AND_RETURN_READY },

    { FW_ERROR_FIRMWARE_ASSERT_FAILED, "FIRMWARE_ASSERT_FAILED", "Internal firmware assertion failed", FW_ACTION_RESTART_FIRMWARE }
};

static const firmware_error_action_entry_t ACTION_TABLE[] = {
    { FW_ACTION_NONE, "NO_ACTION", "No action required" },
    { FW_ACTION_BUTTON_1_RETRY_BUTTON_2_PROVISIONING, "RETRY_OR_PROVISION_VIA_MQTT", "Use cmd/system/retry, or cmd/system/flush-config to clear network config and provision" },
    { FW_ACTION_BUTTON_1_RECONNECT_BUTTON_2_PROVISIONING, "RECONNECT_OR_PROVISION_VIA_MQTT", "Use cmd/system/retry to reconnect, or cmd/system/flush-config to provision" },
    { FW_ACTION_BUTTON_1_RESTART_BUTTON_2_PROVISIONING, "RESTART_OR_PROVISION_VIA_MQTT", "Use cmd/system/retry, cmd/system/reset, or cmd/system/flush-config as appropriate" },
    { FW_ACTION_CHECK_HARDWARE_AND_RETRY, "CHECK_HARDWARE_AND_RETRY", "Check sensor hardware and retry" },
    { FW_ACTION_CHECK_BACKEND_AND_RETRY, "CHECK_BACKEND_AND_RETRY", "Check backend URL/server and retry" },
    { FW_ACTION_CHECK_MQTT_AND_RETRY, "CHECK_MQTT_AND_RETRY", "Check MQTT broker and retry" },
    { FW_ACTION_CLEAR_CONFIG_AND_PROVISION, "CLEAR_CONFIG_AND_PROVISION", "Clear saved config and go provisioning" },
    { FW_ACTION_RESTART_FIRMWARE, "RESTART_FIRMWARE", "Restart firmware" },
    { FW_ACTION_STOP_SESSION_AND_RETURN_READY, "STOP_SESSION_AND_RETURN_READY", "Stop session and return ready if safe" },
    { FW_ACTION_MOVE_TO_TURN_OFF, "MOVE_TO_TURN_OFF", "Move to safe halted state" }
};

const firmware_error_reason_entry_t *error_codes_get_reason_entry(firmware_error_reason_id_t reason_id)
{
    for (size_t i = 0; i < sizeof(REASON_TABLE) / sizeof(REASON_TABLE[0]); i++) {
        if (REASON_TABLE[i].reason_id == reason_id) {
            return &REASON_TABLE[i];
        }
    }

    return &REASON_TABLE[1];
}

const firmware_error_action_entry_t *error_codes_get_action_entry(firmware_error_action_id_t action_id)
{
    for (size_t i = 0; i < sizeof(ACTION_TABLE) / sizeof(ACTION_TABLE[0]); i++) {
        if (ACTION_TABLE[i].action_id == action_id) {
            return &ACTION_TABLE[i];
        }
    }

    return &ACTION_TABLE[0];
}

const char *error_codes_reason_to_string(firmware_error_reason_id_t reason_id)
{
    return error_codes_get_reason_entry(reason_id)->reason_code;
}

const char *error_codes_action_to_string(firmware_error_action_id_t action_id)
{
    return error_codes_get_action_entry(action_id)->action_code;
}

firmware_error_action_id_t error_codes_default_action_for_reason(firmware_error_reason_id_t reason_id)
{
    return error_codes_get_reason_entry(reason_id)->default_action_id;
}
