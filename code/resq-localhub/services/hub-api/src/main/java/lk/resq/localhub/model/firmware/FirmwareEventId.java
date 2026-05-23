package lk.resq.localhub.model.firmware;

import java.util.Arrays;
import java.util.Optional;

public enum FirmwareEventId {
    GENERIC_COMMAND_RESULT(1000),
    DEVICE_IDENTITY(1001),
    DEBUG_COMMAND_RESULT(1002),
    SYSTEM_COMMAND_RESULT(1003),
    SESSION_STARTED(2000),
    SESSION_STOPPED(2001),
    SESSION_INTERRUPTED(2002),
    SESSION_COMMAND_RESULT(2003),
    GENERAL_CPR_FEEDBACK(3000),
    INCOMPLETE_RECOIL_DETECTED(3001),
    WRONG_HAND_PLACEMENT(3002),
    COMPRESSION_RATE_TOO_SLOW(3003),
    COMPRESSION_RATE_TOO_FAST(3004),
    COMPRESSION_DEPTH_TOO_SHALLOW(3005),
    COMPRESSION_DEPTH_GOOD(3006),
    PAUSE_DETECTED(3007),
    CALIBRATION_COMMAND_RESULT(4000),
    CALIBRATION_PROGRESS(4001),
    CALIBRATION_FINAL_RESULT(4002),
    FIRMWARE_ERROR(5000),
    ERROR_COMMAND_RESULT(5001),
    ERROR_RECOVERY(5002);

    private final int value;

    FirmwareEventId(int value) {
        this.value = value;
    }

    public int value() {
        return value;
    }

    public static Optional<FirmwareEventId> fromValue(int value) {
        return Arrays.stream(values()).filter(entry -> entry.value == value).findFirst();
    }
}