package lk.resq.localhub.model.firmware;

import java.util.Arrays;
import java.util.Optional;

public enum FirmwareActionId {
    NO_ACTION_REQUIRED(0),
    SEND_VALID_PAYLOAD(1),
    WAIT_OR_CANCEL(2),
    BUTTON_1_RETRY_BUTTON_2_IDLE(3),
    CHECK_SENSOR_AND_RETRY(4),
    BUTTON_1_CONTINUE_OR_RETRY_BUTTON_2_IDLE(5),
    MOVE_TO_PAIRED_IDLE_AND_DROP_TEMPORARY_VALUES(6),
    STAY_CURRENT_STATE(7),
    MOVE_TO_ERROR(8),
    CLEAR_CONFIG_AND_PROVISION(9),
    RESTART_FIRMWARE(10),
    STOP_SESSION_AND_RETURN_READY(11),
    MOVE_TO_TURN_OFF(12),
    DEVICE_IN_ERROR_USE_SYSTEM_RECOVERY(13);

    private final int value;

    FirmwareActionId(int value) {
        this.value = value;
    }

    public int value() {
        return value;
    }

    public static Optional<FirmwareActionId> fromValue(int value) {
        return Arrays.stream(values()).filter(entry -> entry.value == value).findFirst();
    }
}