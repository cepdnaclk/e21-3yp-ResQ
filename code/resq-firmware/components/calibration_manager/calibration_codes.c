#include "calibration_codes.h"

#include <stddef.h>

static const calibration_reason_entry_t REASON_TABLE[] = {
    {
        CAL_REASON_NONE,
        "NONE",
        "No calibration error",
        CAL_ACTION_NONE
    },
    {
        CAL_REASON_INVALID_CALIBRATION_PAYLOAD,
        "INVALID_CALIBRATION_PAYLOAD",
        "Calibration payload is invalid or missing required fields",
        CAL_ACTION_SEND_VALID_PAYLOAD
    },
    {
        CAL_REASON_CALIBRATION_ALREADY_RUNNING,
        "CALIBRATION_ALREADY_RUNNING",
        "Calibration is already running",
        CAL_ACTION_WAIT_OR_CANCEL
    },
    {
        CAL_REASON_INVALID_HALL_DELTA,
        "INVALID_HALL_DELTA",
        "Hall delta value is invalid or too small",
        CAL_ACTION_SEND_VALID_PAYLOAD
    },
    {
        CAL_REASON_REF_PRESSURE_TIMEOUT,
        "REF_PRESSURE_TIMEOUT",
        "Reference pressure target was not reached",
        CAL_ACTION_BUTTON_1_RETRY_BUTTON_2_IDLE
    },
    {
        CAL_REASON_BLADDER_1_PRESSURE_TIMEOUT,
        "BLADDER_1_PRESSURE_TIMEOUT",
        "Bladder 1 pressure target was not reached",
        CAL_ACTION_BUTTON_1_RETRY_BUTTON_2_IDLE
    },
    {
        CAL_REASON_BLADDER_2_PRESSURE_TIMEOUT,
        "BLADDER_2_PRESSURE_TIMEOUT",
        "Bladder 2 pressure target was not reached",
        CAL_ACTION_BUTTON_1_RETRY_BUTTON_2_IDLE
    },
    {
        CAL_REASON_HALL_BASELINE_READ_FAILED,
        "HALL_BASELINE_READ_FAILED",
        "Hall baseline could not be read",
        CAL_ACTION_BUTTON_1_RETRY_BUTTON_2_IDLE
    },
    {
        CAL_REASON_HALL_FULL_PRESS_TIMEOUT,
        "HALL_FULL_PRESS_TIMEOUT",
        "Hall sensor did not reach full press target",
        CAL_ACTION_BUTTON_1_RETRY_BUTTON_2_IDLE
    },
    {
        CAL_REASON_FULL_PRESS_PRESSURE_READ_FAILED,
        "FULL_PRESS_PRESSURE_READ_FAILED",
        "Full press pressure values could not be read",
        CAL_ACTION_BUTTON_1_RETRY_BUTTON_2_IDLE
    },
    {
        CAL_REASON_PRESSURE_IMBALANCE_TOO_HIGH,
        "PRESSURE_IMBALANCE_TOO_HIGH",
        "Pressure difference between bladder 1 and bladder 2 is too high",
        CAL_ACTION_BUTTON_1_RETRY_BUTTON_2_IDLE
    },
    {
        CAL_REASON_CALIBRATION_VALUES_OUT_OF_RANGE,
        "CALIBRATION_VALUES_OUT_OF_RANGE",
        "Captured calibration values are outside the allowed range",
        CAL_ACTION_BUTTON_1_RETRY_BUTTON_2_IDLE
    },
    {
        CAL_REASON_SENSOR_STUCK_OR_NOISE,
        "SENSOR_STUCK_OR_NOISE",
        "Sensor is stuck, disconnected, or too noisy",
        CAL_ACTION_CHECK_SENSOR_AND_RETRY
    },
    {
        CAL_REASON_HALL_RANGE_TOO_SMALL,
        "HALL_RANGE_TOO_SMALL",
        "Hall sensor movement range is too small for reliable detection",
        CAL_ACTION_CHECK_SENSOR_AND_RETRY
    },
    {
        CAL_REASON_HALL_NOISE_TOO_HIGH,
        "HALL_NOISE_TOO_HIGH",
        "Hall sensor noise is too high for calibration",
        CAL_ACTION_CHECK_SENSOR_AND_RETRY
    },
    {
        CAL_REASON_PRESSURE_RANGE_TOO_SMALL,
        "PRESSURE_RANGE_TOO_SMALL",
        "Pressure sensors show insufficient full-press range",
        CAL_ACTION_CHECK_SENSOR_AND_RETRY
    },
    {
        CAL_REASON_PRESSURE_NOISE_TOO_HIGH,
        "PRESSURE_NOISE_TOO_HIGH",
        "Pressure sensor noise is too high for calibration",
        CAL_ACTION_CHECK_SENSOR_AND_RETRY
    },
    {
        CAL_REASON_ADAPTIVE_THRESHOLD_INVALID,
        "ADAPTIVE_THRESHOLD_INVALID",
        "Derived adaptive thresholds are invalid",
        CAL_ACTION_CHECK_SENSOR_AND_RETRY
    },
    {
        CAL_REASON_PRESSURE_SENSOR_SATURATED,
        "PRESSURE_SENSOR_SATURATED",
        "Pressure sensor readings are saturated",
        CAL_ACTION_CHECK_SENSOR_AND_RETRY
    },
    {
        CAL_REASON_PRESSURE_SENSOR_FLOATING_OR_DISCONNECTED,
        "PRESSURE_SENSOR_FLOATING_OR_DISCONNECTED",
        "Pressure sensor appears floating or disconnected",
        CAL_ACTION_CHECK_SENSOR_AND_RETRY
    },
    {
        CAL_REASON_PRESSURE_BASELINE_UNSTABLE,
        "PRESSURE_BASELINE_UNSTABLE",
        "Pressure sensor baseline is unstable",
        CAL_ACTION_CHECK_SENSOR_AND_RETRY
    },
    {
        CAL_REASON_PRESSURE_SENSOR_SATURATED_USING_LAST_STABLE,
        "PRESSURE_SENSOR_SATURATED_USING_LAST_STABLE",
        "Pressure sensor saturated or unusable; continuing with last stable pressure state and Hall sensor",
        CAL_ACTION_NONE
    },
    {
        CAL_REASON_NVS_SAVE_FAILED,
        "NVS_SAVE_FAILED",
        "Calibration values were captured but could not be saved to NVS",
        CAL_ACTION_BUTTON_1_RETRY_BUTTON_2_IDLE
    },
    {
        CAL_REASON_CORRUPT,
        "CORRUPT",
        "Calibration storage is corrupt and cannot be loaded",
        CAL_ACTION_BUTTON_1_RETRY_BUTTON_2_IDLE
    },
    {
        CAL_REASON_UNSUPPORTED_SCHEMA,
        "UNSUPPORTED_SCHEMA",
        "Calibration storage schema version is not supported",
        CAL_ACTION_BUTTON_1_RETRY_BUTTON_2_IDLE
    },
    {
        CAL_REASON_IO_ERROR,
        "IO_ERROR",
        "Calibration NVS I/O error occurred",
        CAL_ACTION_BUTTON_1_RETRY_BUTTON_2_IDLE
    },
    {
        CAL_REASON_COMMIT_VERIFICATION_FAILED,
        "COMMIT_VERIFICATION_FAILED",
        "Calibration commit succeeded but committed record could not be verified",
        CAL_ACTION_BUTTON_1_RETRY_BUTTON_2_IDLE
    },
    {
        CAL_REASON_GENERATION_EXHAUSTED,
        "GENERATION_EXHAUSTED",
        "Calibration generation counter has been exhausted",
        CAL_ACTION_MOVE_TO_ERROR
    },
    {
        CAL_REASON_PROFILE_HASH_MISMATCH,
        "PROFILE_HASH_MISMATCH",
        "Calibration profile hash does not match the committed record",
        CAL_ACTION_SEND_VALID_PAYLOAD
    },
    {
        CAL_REASON_MQTT_DISCONNECTED_DURING_CALIBRATION,
        "MQTT_DISCONNECTED_DURING_CALIBRATION",
        "MQTT disconnected during calibration",
        CAL_ACTION_BUTTON_1_CONTINUE_BUTTON_2_IDLE
    },
    {
        CAL_REASON_WIFI_DISCONNECTED_DURING_CALIBRATION,
        "WIFI_DISCONNECTED_DURING_CALIBRATION",
        "Wi-Fi disconnected during calibration",
        CAL_ACTION_BUTTON_1_CONTINUE_BUTTON_2_IDLE
    },
    {
        CAL_REASON_CALIBRATION_CANCELLED,
        "CALIBRATION_CANCELLED",
        "Calibration was cancelled by command",
        CAL_ACTION_MOVE_TO_PAIRED_IDLE_DROP_TEMP
    }
};

static const calibration_action_entry_t ACTION_TABLE[] = {
    {
        CAL_ACTION_NONE,
        "NONE",
        "No action required"
    },
    {
        CAL_ACTION_SEND_VALID_PAYLOAD,
        "SEND_VALID_PAYLOAD",
        "Send a valid calibration payload"
    },
    {
        CAL_ACTION_WAIT_OR_CANCEL,
        "WAIT_OR_CANCEL",
        "Wait for calibration to finish or cancel it"
    },
    {
        CAL_ACTION_BUTTON_1_RETRY_BUTTON_2_IDLE,
        "BUTTON_1_RETRY_BUTTON_2_IDLE",
        "Press BUTTON_1 to retry calibration, or BUTTON_2 to return to paired idle"
    },
    {
        CAL_ACTION_CHECK_SENSOR_AND_RETRY,
        "CHECK_SENSOR_AND_RETRY",
        "Check sensor wiring/noise/stability and retry"
    },
    {
        CAL_ACTION_BUTTON_1_CONTINUE_BUTTON_2_IDLE,
        "BUTTON_1_CONTINUE_BUTTON_2_IDLE",
        "Press BUTTON_1 to continue or retry from the last safe process, or BUTTON_2 to return to paired idle"
    },
    {
        CAL_ACTION_MOVE_TO_PAIRED_IDLE_DROP_TEMP,
        "MOVE_TO_PAIRED_IDLE_DROP_TEMP",
        "Drop temporary measured calibration values and return to paired idle"
    },
    {
        CAL_ACTION_STAY_CURRENT_STATE,
        "STAY_CURRENT_STATE",
        "Stay in current state"
    },
    {
        CAL_ACTION_MOVE_TO_ERROR,
        "MOVE_TO_ERROR",
        "Move to firmware error state"
    }
};

const calibration_reason_entry_t *calibration_codes_get_reason_entry(calibration_reason_id_t reason_id)
{
    for (size_t i = 0; i < sizeof(REASON_TABLE) / sizeof(REASON_TABLE[0]); i++) {
        if (REASON_TABLE[i].reason_id == reason_id) {
            return &REASON_TABLE[i];
        }
    }

    return &REASON_TABLE[0];
}

const calibration_action_entry_t *calibration_codes_get_action_entry(calibration_action_id_t action_id)
{
    for (size_t i = 0; i < sizeof(ACTION_TABLE) / sizeof(ACTION_TABLE[0]); i++) {
        if (ACTION_TABLE[i].action_id == action_id) {
            return &ACTION_TABLE[i];
        }
    }

    return &ACTION_TABLE[0];
}

const char *calibration_codes_reason_to_string(calibration_reason_id_t reason_id)
{
    return calibration_codes_get_reason_entry(reason_id)->reason_code;
}

const char *calibration_codes_action_to_string(calibration_action_id_t action_id)
{
    return calibration_codes_get_action_entry(action_id)->action_code;
}

calibration_action_id_t calibration_codes_default_action_for_reason(calibration_reason_id_t reason_id)
{
    return calibration_codes_get_reason_entry(reason_id)->default_action_id;
}
