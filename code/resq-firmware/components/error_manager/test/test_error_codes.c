#include "error_codes.h"
#include "error_manager.h"
#include "unity.h"

TEST_CASE("Firmware error tables map all defined reasons", "[error]")
{
    const firmware_error_reason_id_t reasons[] = {
        FW_ERROR_UNKNOWN_ERROR,
        FW_ERROR_INVALID_STATE_TRANSITION,
        FW_ERROR_UNSUPPORTED_STATE,
        FW_ERROR_NVS_INIT_FAILED,
        FW_ERROR_NVS_LOAD_FAILED,
        FW_ERROR_NVS_SAVE_FAILED,
        FW_ERROR_CONFIG_INVALID,
        FW_ERROR_WIFI_CONNECT_FAILED,
        FW_ERROR_WIFI_DISCONNECTED_UNRECOVERABLE,
        FW_ERROR_WIFI_NO_IP_ASSIGNED,
        FW_ERROR_BACKEND_REGISTER_FAILED,
        FW_ERROR_BACKEND_INVALID_RESPONSE,
        FW_ERROR_BACKEND_DEVICE_REJECTED,
        FW_ERROR_MQTT_CONNECT_FAILED,
        FW_ERROR_MQTT_DISCONNECTED_UNRECOVERABLE,
        FW_ERROR_MQTT_SUBSCRIBE_FAILED,
        FW_ERROR_MQTT_PUBLISH_FAILED,
        FW_ERROR_HX710_INIT_FAILED,
        FW_ERROR_HX710_READ_FAILED,
        FW_ERROR_HALL_SENSOR_INIT_FAILED,
        FW_ERROR_HALL_SENSOR_READ_FAILED,
        FW_ERROR_SENSOR_RUNTIME_FAILED,
        FW_ERROR_TASK_CREATE_FAILED,
        FW_ERROR_QUEUE_CREATE_FAILED,
        FW_ERROR_MUTEX_CREATE_FAILED,
        FW_ERROR_MEMORY_ALLOCATION_FAILED,
        FW_ERROR_SESSION_START_FAILED,
        FW_ERROR_TELEMETRY_TASK_FAILED,
        FW_ERROR_BUZZER_TASK_FAILED,
        FW_ERROR_SESSION_INTERRUPTED_UNRECOVERABLE,
        FW_ERROR_FIRMWARE_ASSERT_FAILED,
    };

    for (size_t i = 0; i < sizeof(reasons) / sizeof(reasons[0]); i++) {
        const firmware_error_reason_entry_t *entry =
            error_codes_get_reason_entry(reasons[i]);
        TEST_ASSERT_NOT_NULL(entry);
        TEST_ASSERT_NOT_NULL(entry->reason_code);
        TEST_ASSERT_NOT_NULL(entry->message);
        TEST_ASSERT_NOT_EQUAL(FW_ACTION_NONE,
                              error_codes_default_action_for_reason(reasons[i]));
    }
}

TEST_CASE("Firmware error lookups handle unknown IDs", "[error]")
{
    TEST_ASSERT_EQUAL(FW_ERROR_UNKNOWN_ERROR,
                      error_codes_get_reason_entry(
                          (firmware_error_reason_id_t)9999)->reason_id);
    TEST_ASSERT_EQUAL_STRING("UNKNOWN_ERROR",
                             error_codes_reason_to_string(
                                 (firmware_error_reason_id_t)9999));
}

static void assert_retry_state(firmware_error_reason_id_t reason,
                               resq_state_t expected)
{
    TEST_ASSERT_EQUAL(ESP_OK, error_manager_set_error(reason));
    TEST_ASSERT_EQUAL(expected, error_manager_get_retry_state());
}

TEST_CASE("Error manager maps every recovery family to its retry state", "[error]")
{
    assert_retry_state(FW_ERROR_WIFI_CONNECT_FAILED,
                       RESQ_STATE_WIFI_CONNECTING);
    assert_retry_state(FW_ERROR_WIFI_DISCONNECTED_UNRECOVERABLE,
                       RESQ_STATE_WIFI_CONNECTING);
    assert_retry_state(FW_ERROR_WIFI_NO_IP_ASSIGNED,
                       RESQ_STATE_WIFI_CONNECTING);

    assert_retry_state(FW_ERROR_BACKEND_REGISTER_FAILED,
                       RESQ_STATE_BACKEND_REGISTERING);
    assert_retry_state(FW_ERROR_BACKEND_INVALID_RESPONSE,
                       RESQ_STATE_BACKEND_REGISTERING);
    assert_retry_state(FW_ERROR_BACKEND_DEVICE_REJECTED,
                       RESQ_STATE_BACKEND_REGISTERING);

    assert_retry_state(FW_ERROR_MQTT_CONNECT_FAILED,
                       RESQ_STATE_MQTT_CONNECTING);
    assert_retry_state(FW_ERROR_MQTT_DISCONNECTED_UNRECOVERABLE,
                       RESQ_STATE_MQTT_CONNECTING);
    assert_retry_state(FW_ERROR_MQTT_SUBSCRIBE_FAILED,
                       RESQ_STATE_MQTT_CONNECTING);
    assert_retry_state(FW_ERROR_MQTT_PUBLISH_FAILED,
                       RESQ_STATE_MQTT_CONNECTING);

    assert_retry_state(FW_ERROR_HX710_INIT_FAILED, RESQ_STATE_PAIRED_IDLE);
    assert_retry_state(FW_ERROR_HX710_READ_FAILED, RESQ_STATE_PAIRED_IDLE);
    assert_retry_state(FW_ERROR_HALL_SENSOR_INIT_FAILED,
                       RESQ_STATE_PAIRED_IDLE);
    assert_retry_state(FW_ERROR_HALL_SENSOR_READ_FAILED,
                       RESQ_STATE_PAIRED_IDLE);
    assert_retry_state(FW_ERROR_SENSOR_RUNTIME_FAILED,
                       RESQ_STATE_PAIRED_IDLE);

    assert_retry_state(FW_ERROR_SESSION_START_FAILED,
                       RESQ_STATE_READY_FOR_SESSION);
    assert_retry_state(FW_ERROR_TELEMETRY_TASK_FAILED,
                       RESQ_STATE_READY_FOR_SESSION);
    assert_retry_state(FW_ERROR_BUZZER_TASK_FAILED,
                       RESQ_STATE_READY_FOR_SESSION);
    assert_retry_state(FW_ERROR_SESSION_INTERRUPTED_UNRECOVERABLE,
                       RESQ_STATE_READY_FOR_SESSION);

    assert_retry_state(FW_ERROR_NVS_LOAD_FAILED, RESQ_STATE_FLUSH_CONFIG);
    assert_retry_state(FW_ERROR_CONFIG_INVALID, RESQ_STATE_FLUSH_CONFIG);

    assert_retry_state(FW_ERROR_NVS_INIT_FAILED, RESQ_STATE_RESETTING);
    assert_retry_state(FW_ERROR_TASK_CREATE_FAILED, RESQ_STATE_RESETTING);
    assert_retry_state(FW_ERROR_QUEUE_CREATE_FAILED, RESQ_STATE_RESETTING);
    assert_retry_state(FW_ERROR_MUTEX_CREATE_FAILED, RESQ_STATE_RESETTING);
    assert_retry_state(FW_ERROR_MEMORY_ALLOCATION_FAILED, RESQ_STATE_RESETTING);
    assert_retry_state(FW_ERROR_FIRMWARE_ASSERT_FAILED, RESQ_STATE_RESETTING);
    assert_retry_state(FW_ERROR_UNKNOWN_ERROR, RESQ_STATE_RESETTING);
    assert_retry_state(FW_ERROR_INVALID_STATE_TRANSITION,
                       RESQ_STATE_RESETTING);
    assert_retry_state(FW_ERROR_UNSUPPORTED_STATE, RESQ_STATE_RESETTING);
}
