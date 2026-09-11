package lk.resq.localhub.model.firmware;

public enum CalibrationState {
    UNKNOWN,
    NOT_READY,
    STARTING,
    CALIBRATING,
    READY,
    FAILED,
    INTERRUPTED,
    CANCELLED
}
