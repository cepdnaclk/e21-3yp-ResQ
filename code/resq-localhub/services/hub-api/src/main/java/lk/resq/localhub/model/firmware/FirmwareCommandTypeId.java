package lk.resq.localhub.model.firmware;

import java.util.Arrays;
import java.util.Optional;

public enum FirmwareCommandTypeId {
    DEBUG(100),
    CALIBRATION_START(200),
    CALIBRATION_CANCEL(201),
    SESSION_START(300),
    SESSION_STOP(301),
    SYSTEM_RETRY(400),
    SYSTEM_RESET(401),
    SYSTEM_FLUSH_CONFIG(402);

    private final int value;

    FirmwareCommandTypeId(int value) {
        this.value = value;
    }

    public int value() {
        return value;
    }

    public static Optional<FirmwareCommandTypeId> fromValue(int value) {
        return Arrays.stream(values()).filter(entry -> entry.value == value).findFirst();
    }
}