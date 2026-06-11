package lk.resq.localhub.model.firmware;

import java.util.Arrays;
import java.util.Optional;

public enum FirmwareProgressId {
    NONE(0),
    CALIBRATION_STARTED(1),
    WAITING_REFERENCE_PRESSURE(2),
    REFERENCE_PRESSURE_MATCHED(3),
    WAITING_BLADDER_1_PRESSURE(4),
    BLADDER_1_PRESSURE_MATCHED(5),
    WAITING_BLADDER_2_PRESSURE(6),
    BLADDER_2_PRESSURE_MATCHED(7),
    HALL_BASELINE_CAPTURED(8),
    WAITING_FULL_PRESS(9),
    FULL_PRESS_CAPTURED(10),
    CALIBRATION_SAVED(11),
    CALIBRATION_FAILED(12),
    CALIBRATION_INTERRUPTED(13);

    private final int value;

    FirmwareProgressId(int value) {
        this.value = value;
    }

    public int value() {
        return value;
    }

    public static Optional<FirmwareProgressId> fromValue(int value) {
        return Arrays.stream(values()).filter(entry -> entry.value == value).findFirst();
    }
}