#ifndef CALIBRATION_CODES_H
#define CALIBRATION_CODES_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    CAL_REASON_NONE = 0,

    CAL_REASON_INVALID_CALIBRATION_PAYLOAD = 100,
    CAL_REASON_CALIBRATION_ALREADY_RUNNING = 101,
    CAL_REASON_INVALID_HALL_DELTA = 102,

    CAL_REASON_REF_PRESSURE_TIMEOUT = 200,
    CAL_REASON_BLADDER_1_PRESSURE_TIMEOUT = 201,
    CAL_REASON_BLADDER_2_PRESSURE_TIMEOUT = 202,
    CAL_REASON_HALL_BASELINE_READ_FAILED = 203,
    CAL_REASON_HALL_FULL_PRESS_TIMEOUT = 204,
    CAL_REASON_FULL_PRESS_PRESSURE_READ_FAILED = 205,
    CAL_REASON_PRESSURE_IMBALANCE_TOO_HIGH = 206,
    CAL_REASON_CALIBRATION_VALUES_OUT_OF_RANGE = 207,
    CAL_REASON_SENSOR_STUCK_OR_NOISE = 208,
    CAL_REASON_HALL_RANGE_TOO_SMALL = 209,
    CAL_REASON_HALL_NOISE_TOO_HIGH = 210,
    CAL_REASON_PRESSURE_RANGE_TOO_SMALL = 211,
    CAL_REASON_PRESSURE_NOISE_TOO_HIGH = 212,
    CAL_REASON_ADAPTIVE_THRESHOLD_INVALID = 213,
    CAL_REASON_PRESSURE_SENSOR_SATURATED = 214,
    CAL_REASON_PRESSURE_SENSOR_FLOATING_OR_DISCONNECTED = 215,
    CAL_REASON_PRESSURE_BASELINE_UNSTABLE = 216,

    CAL_REASON_NVS_SAVE_FAILED = 300,

    CAL_REASON_MQTT_DISCONNECTED_DURING_CALIBRATION = 400,
    CAL_REASON_WIFI_DISCONNECTED_DURING_CALIBRATION = 401,

    CAL_REASON_CALIBRATION_CANCELLED = 900
} calibration_reason_id_t;

typedef enum {
    CAL_ACTION_NONE = 0,
    CAL_ACTION_SEND_VALID_PAYLOAD = 1,
    CAL_ACTION_WAIT_OR_CANCEL = 2,
    CAL_ACTION_BUTTON_1_RETRY_BUTTON_2_IDLE = 3,
    CAL_ACTION_CHECK_SENSOR_AND_RETRY = 4,
    CAL_ACTION_BUTTON_1_CONTINUE_BUTTON_2_IDLE = 5,
    CAL_ACTION_MOVE_TO_PAIRED_IDLE_DROP_TEMP = 6,
    CAL_ACTION_STAY_CURRENT_STATE = 7,
    CAL_ACTION_MOVE_TO_ERROR = 8
} calibration_action_id_t;

typedef struct {
    calibration_reason_id_t reason_id;
    const char *reason_code;
    const char *message;
    calibration_action_id_t default_action_id;
} calibration_reason_entry_t;

typedef struct {
    calibration_action_id_t action_id;
    const char *action_code;
    const char *message;
} calibration_action_entry_t;

const calibration_reason_entry_t *calibration_codes_get_reason_entry(calibration_reason_id_t reason_id);

const calibration_action_entry_t *calibration_codes_get_action_entry(calibration_action_id_t action_id);

const char *calibration_codes_reason_to_string(calibration_reason_id_t reason_id);

const char *calibration_codes_action_to_string(calibration_action_id_t action_id);

calibration_action_id_t calibration_codes_default_action_for_reason(calibration_reason_id_t reason_id);

#ifdef __cplusplus
}
#endif

#endif
